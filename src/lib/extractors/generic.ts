import * as cheerio from "cheerio";
import { detectUnit, parseRangeCm, type Unit } from "@/lib/normalizers/units";
import type { SizeRow } from "@/lib/types";

const SIZE_LABEL_REGEX =
  /^(XXS|XS|S|M|L|XL|XXL|XXXL|3XL|4XL|5XL|\d{2,3}(?:\/\d{2,3})?|\d{2,3}-\d{2,3})$/i;

const COLUMN_KEYWORDS: Array<{ keys: RegExp; field: keyof SizeRow }> = [
  { keys: /(chest|bust|poitrine|tour de poitrine)/i, field: "chestCmMin" },
  { keys: /(waist|taille\b|tour de taille)/i, field: "waistCmMin" },
  { keys: /(hip|hanche|hips|tour de hanche)/i, field: "hipsCmMin" },
  { keys: /(inseam|entrejambe|inside leg)/i, field: "inseamCmMin" },
  { keys: /(neck|cou|encolure|collar)/i, field: "neckCmMin" },
  { keys: /(shoulder|\bépaule|epaule)/i, field: "shoulderCmMin" },
  { keys: /(sleeve|manche)/i, field: "sleeveCmMin" },
  { keys: /(foot|pied|foot length)/i, field: "footCmMin" },
];

const FIELD_PAIRS: Record<string, [keyof SizeRow, keyof SizeRow]> = {
  chestCmMin: ["chestCmMin", "chestCmMax"],
  waistCmMin: ["waistCmMin", "waistCmMax"],
  hipsCmMin: ["hipsCmMin", "hipsCmMax"],
  inseamCmMin: ["inseamCmMin", "inseamCmMax"],
  neckCmMin: ["neckCmMin", "neckCmMax"],
  shoulderCmMin: ["shoulderCmMin", "shoulderCmMax"],
  sleeveCmMin: ["sleeveCmMin", "sleeveCmMax"],
  footCmMin: ["footCmMin", "footCmMax"],
};

interface ExtractedTable {
  score: number;
  rows: SizeRow[];
  unitHint: Unit;
}

/** Identify which SizeRow field a column header maps to. */
function fieldForHeader(header: string): keyof SizeRow | null {
  for (const { keys, field } of COLUMN_KEYWORDS) {
    if (keys.test(header)) return field;
  }
  return null;
}

/** Detect if a label looks like a size label. */
function isSizeLabel(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 12) return false;
  return SIZE_LABEL_REGEX.test(t);
}

/** Score how likely a 2D matrix represents a size guide. */
function scoreMatrix(headers: string[], rows: string[][]): number {
  let score = 0;
  for (const h of headers) {
    if (fieldForHeader(h)) score += 3;
    if (/size|taille/i.test(h)) score += 2;
  }
  let labelRows = 0;
  for (const r of rows) {
    if (r[0] && isSizeLabel(r[0])) labelRows++;
  }
  score += labelRows * 2;
  if (rows.length >= 2) score += 1;
  return score;
}

/** Build SizeRow[] from a header row + body rows, converting to cm. */
function buildRows(headers: string[], rows: string[][], unit: Unit): SizeRow[] {
  const colMap = headers.map((h) => fieldForHeader(h));
  const result: SizeRow[] = [];
  for (const r of rows) {
    if (!r[0] || !r[0].trim()) continue;
    const row: SizeRow = { label: r[0].trim() };
    let hasMeasure = false;
    for (let i = 1; i < r.length; i++) {
      const baseField = colMap[i];
      if (!baseField) continue;
      const parsed = parseRangeCm(r[i] ?? "", unit === "unknown" ? "cm" : unit);
      if (!parsed) continue;
      const [minF, maxF] = FIELD_PAIRS[baseField] ?? [baseField, baseField];
      (row as Record<string, number>)[minF as string] = parsed[0];
      (row as Record<string, number>)[maxF as string] = parsed[1];
      hasMeasure = true;
    }
    if (hasMeasure || isSizeLabel(row.label)) result.push(row);
  }
  return result;
}

/** Extract from <table> elements. */
function extractFromTables($: cheerio.CheerioAPI, pageUnit: Unit): ExtractedTable[] {
  const candidates: ExtractedTable[] = [];
  $("table").each((_, tbl) => {
    const $tbl = $(tbl);
    const headerCells = $tbl.find("thead th, thead td").toArray();
    let headers: string[] = headerCells.map((c) => $(c).text().trim());
    const bodyRows: string[][] = [];
    $tbl.find("tbody tr").each((_, tr) => {
      const cells = $(tr)
        .find("th, td")
        .toArray()
        .map((c) => $(c).text().trim());
      if (cells.length) bodyRows.push(cells);
    });
    if (!headers.length) {
      const allRows = $tbl
        .find("tr")
        .toArray()
        .map((tr) =>
          $(tr)
            .find("th, td")
            .toArray()
            .map((c) => $(c).text().trim()),
        );
      if (allRows.length >= 2) {
        headers = allRows[0];
        bodyRows.push(...allRows.slice(1));
      }
    }
    if (!headers.length || !bodyRows.length) return;
    const tableText = $tbl.text();
    const unit = detectUnit(tableText) === "unknown" ? pageUnit : detectUnit(tableText);
    const score = scoreMatrix(headers, bodyRows);
    if (score < 3) return;
    const rows = buildRows(headers, bodyRows, unit);
    if (rows.length) candidates.push({ score: score + rows.length, rows, unitHint: unit });
  });
  return candidates;
}

/** Extract from CSS-grid / role-based tables. */
function extractFromAriaGrids($: cheerio.CheerioAPI, pageUnit: Unit): ExtractedTable[] {
  const candidates: ExtractedTable[] = [];
  $('[role="table"]').each((_, grid) => {
    const $g = $(grid);
    const rows = $g.find('[role="row"]').toArray();
    if (rows.length < 2) return;
    const matrix = rows.map((r) =>
      $(r)
        .find('[role="cell"], [role="columnheader"], [role="rowheader"]')
        .toArray()
        .map((c) => $(c).text().trim()),
    );
    const headers = matrix[0];
    const body = matrix.slice(1);
    const unit = detectUnit($g.text()) === "unknown" ? pageUnit : detectUnit($g.text());
    const score = scoreMatrix(headers, body);
    if (score < 3) return;
    const built = buildRows(headers, body, unit);
    if (built.length) candidates.push({ score: score + built.length, rows: built, unitHint: unit });
  });
  return candidates;
}

/** Heuristic: scan plain text for `S 88-96 cm` style lines. */
function extractFromText(text: string, pageUnit: Unit): ExtractedTable[] {
  const unit = detectUnit(text) === "unknown" ? pageUnit : detectUnit(text);
  const lines = text.split(/\r?\n/);
  const rows: SizeRow[] = [];
  for (const ln of lines) {
    const m = ln.match(
      /^\s*(XXS|XS|S|M|L|XL|XXL|XXXL|\d{2,3}(?:\/\d{2,3})?)\s+(.{2,200})$/i,
    );
    if (!m) continue;
    const label = m[1];
    const rest = m[2];
    const parts = rest
      .split(/\s{2,}|\t|\|/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 1) continue;
    const row: SizeRow = { label };
    // best-effort: assume order chest, waist, hips
    const order: Array<[keyof SizeRow, keyof SizeRow]> = [
      ["chestCmMin", "chestCmMax"],
      ["waistCmMin", "waistCmMax"],
      ["hipsCmMin", "hipsCmMax"],
      ["inseamCmMin", "inseamCmMax"],
    ];
    let placed = 0;
    for (const part of parts) {
      const parsed = parseRangeCm(part, unit === "unknown" ? "cm" : unit);
      if (!parsed) continue;
      const slot = order[placed];
      if (!slot) break;
      (row as Record<string, number>)[slot[0] as string] = parsed[0];
      (row as Record<string, number>)[slot[1] as string] = parsed[1];
      placed++;
    }
    if (placed > 0) rows.push(row);
  }
  if (!rows.length) return [];
  return [{ score: rows.length, rows, unitHint: unit }];
}

export interface ExtractionResult {
  rows: SizeRow[];
  unit: Unit;
  strategy: "table" | "aria-grid" | "text" | "none";
  score: number;
}

/** Main entry: try each strategy, return the highest-scoring extraction. */
export function extractSizeGuide(html: string, fallbackText?: string): ExtractionResult {
  const $ = cheerio.load(html);
  const pageUnit = detectUnit($.root().text());
  const candidates: Array<ExtractionResult> = [];

  for (const c of extractFromTables($, pageUnit)) {
    candidates.push({ rows: c.rows, unit: c.unitHint, strategy: "table", score: c.score });
  }
  for (const c of extractFromAriaGrids($, pageUnit)) {
    candidates.push({ rows: c.rows, unit: c.unitHint, strategy: "aria-grid", score: c.score });
  }

  if (!candidates.length) {
    const text = fallbackText ?? $.root().text();
    for (const c of extractFromText(text, pageUnit)) {
      candidates.push({ rows: c.rows, unit: c.unitHint, strategy: "text", score: c.score });
    }
  }

  if (!candidates.length) {
    return { rows: [], unit: pageUnit, strategy: "none", score: 0 };
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}
