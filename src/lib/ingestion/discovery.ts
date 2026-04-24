import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { detectFields, detectMeasurementUnit } from "@/lib/ingestion/measurements";
import {
  detectAudience,
  detectCategory,
  detectFitVariant,
  detectSizeSystem,
  isSizeLikeLabel,
} from "@/lib/ingestion/taxonomy";
import type { CandidateKind, CandidateSection, SourceType } from "@/lib/types";

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function makeId(index: number): string {
  return `candidate-${index + 1}`;
}

function inferPageSourceType(url: string, candidateCount: number): SourceType {
  const lower = url.toLowerCase();
  if (candidateCount > 1 || /(size-fit-guide|size-guide|size-chart|guide-des-tailles)/.test(lower)) {
    return "generic-multi-guide-page";
  }
  if (/(product|sku|\/p\/|\/products\/)/.test(lower)) {
    return "product-page-size-guide";
  }
  return "category-specific-page";
}

function extractHtmlTableMatrix(
  $: cheerio.CheerioAPI,
  table: Element,
): string[][] {
  const rows = $(table)
    .find("tr")
    .toArray()
    .map((row) =>
      $(row)
        .find("th, td")
        .toArray()
        .map((cell) => cleanText($(cell).text())),
    )
    .filter((row) => row.some(Boolean));
  return rows;
}

function extractAriaGridMatrix(
  $: cheerio.CheerioAPI,
  grid: Element,
): string[][] {
  return $(grid)
    .find('[role="row"]')
    .toArray()
    .map((row) =>
      $(row)
        .find('[role="cell"], [role="columnheader"], [role="rowheader"]')
        .toArray()
        .map((cell) => cleanText($(cell).text())),
    )
    .filter((row) => row.some(Boolean));
}

function collectHeadingPath(
  $: cheerio.CheerioAPI,
  element: Element,
): string[] {
  const headings: string[] = [];
  let current = $(element);

  while (current.length) {
    const previousHeading = current.prevAll("h1, h2, h3, h4, h5, h6").first();
    const text = cleanText(previousHeading.text());
    if (text && !headings.includes(text)) {
      headings.unshift(text);
    }
    current = current.parent();
  }

  return headings.slice(-3);
}

function collectSubheading(
  $: cheerio.CheerioAPI,
  element: Element,
): string | undefined {
  const parent = $(element).parent();
  const sibling = parent
    .children("p, strong, span, div")
    .toArray()
    .map((node) => cleanText($(node).text()))
    .find((text) => text.length > 0 && text.length <= 140);
  return sibling || undefined;
}

function collectNearbyText(
  $: cheerio.CheerioAPI,
  element: Element,
): string {
  const chunks: string[] = [];
  let previous = $(element).prev();
  while (previous.length && chunks.join(" ").length < 260) {
    if (previous.is("h1, h2, h3, h4, h5, h6, table, [role='table']")) break;
    const text = cleanText(previous.text());
    if (text) chunks.unshift(text);
    previous = previous.prev();
  }

  let next = $(element).next();
  while (next.length && chunks.join(" ").length < 420) {
    if (next.is("h1, h2, h3, h4, h5, h6, table, [role='table']")) break;
    const text = cleanText(next.text());
    if (text) chunks.push(text);
    next = next.next();
  }

  return chunks.join(" ").slice(0, 420);
}

function createCandidate(args: {
  id: string;
  kind: CandidateKind;
  sourceUrl: string;
  sourceType: SourceType;
  matrix: string[][];
  headingPath: string[];
  sectionTitle: string;
  subheading?: string;
  nearbyAdvisoryText: string;
}): CandidateSection {
  const visibleColumnLabels = args.matrix[0] ?? [];
  const visibleRowLabels = args.matrix
    .slice(1)
    .map((row) => cleanText(row[0] ?? ""))
    .filter(Boolean);
  const fields = detectFields(visibleColumnLabels);
  const contextText = [
    args.sectionTitle,
    args.subheading ?? "",
    args.headingPath.join(" "),
    args.nearbyAdvisoryText,
    ...visibleColumnLabels,
  ].join(" ");
  const category = detectCategory({
    sectionTitle: args.sectionTitle,
    subheading: args.subheading,
    headers: visibleColumnLabels,
    rowLabels: visibleRowLabels,
    nearbyText: args.nearbyAdvisoryText,
    fields,
  });
  const sizeLikeRows = visibleRowLabels.filter(isSizeLikeLabel);
  const extractionConfidence = Math.max(
    0.1,
    Math.min(
      0.98,
      0.2 +
        (fields.length > 0 ? 0.2 : 0) +
        Math.min(sizeLikeRows.length, 8) * 0.06 +
        (args.kind === "advisory-text" ? -0.2 : 0) +
        (category.detectedCategory !== "unknown" ? 0.15 : 0),
    ),
  );

  const evidenceSnippet = [
    args.sectionTitle,
    args.subheading,
    visibleColumnLabels.length ? `Columns: ${visibleColumnLabels.join(", ")}` : "",
    sizeLikeRows.length ? `Rows: ${sizeLikeRows.slice(0, 8).join(", ")}` : "",
    args.nearbyAdvisoryText,
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 500);

  return {
    id: args.id,
    kind: args.kind,
    isTabular: args.kind !== "advisory-text",
    sourceUrl: args.sourceUrl,
    sourceType: args.sourceType,
    sectionTitle: args.sectionTitle || "Untitled section",
    subheading: args.subheading,
    headingPath: args.headingPath,
    audience: detectAudience(contextText),
    garmentFamily: category.garmentFamily,
    detectedCategory: category.detectedCategory,
    detectedCategoryLabel: category.detectedCategoryLabel,
    fitVariant: detectFitVariant(contextText),
    detectedSizeSystem: detectSizeSystem({
      rowLabels: sizeLikeRows,
      headers: visibleColumnLabels,
      context: contextText,
    }),
    originalUnitSystem: detectMeasurementUnit(
      `${contextText} ${args.matrix.flat().join(" ")}`,
    ),
    visibleColumnLabels,
    visibleRowLabels: sizeLikeRows,
    nearbyAdvisoryText: args.nearbyAdvisoryText,
    rawEvidenceSnippet: evidenceSnippet,
    matrix: args.matrix,
    extractionConfidence,
    selectionScore: 0,
    matchReasons: category.reasons,
    rejectionReasons: [],
    warnings:
      args.kind === "advisory-text"
        ? ["Advisory text was detected without a nearby structured table."]
        : [],
  };
}

function parseMarkdownRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, "");
  return trimmed.split("|").map((cell) => cleanText(cell));
}

function isMarkdownSeparator(line: string): boolean {
  return /^[:|\-\s]+$/.test(line.trim());
}

function discoverMarkdownTables(
  markdown: string,
  sourceUrl: string,
  sourceType: SourceType,
  indexOffset: number,
): CandidateSection[] {
  const lines = markdown.split(/\r?\n/);
  const candidates: CandidateSection[] = [];
  let headingPath: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      headingPath = [...headingPath.slice(-2), cleanText(headingMatch[2])];
      continue;
    }

    if (!line.includes("|")) continue;
    const separator = lines[i + 1]?.trim() ?? "";
    if (!isMarkdownSeparator(separator)) continue;

    const matrix: string[][] = [parseMarkdownRow(line)];
    let j = i + 2;
    while (j < lines.length && lines[j].includes("|")) {
      const row = parseMarkdownRow(lines[j]);
      if (!row.some(Boolean)) break;
      matrix.push(row);
      j++;
    }

    if (matrix.length < 2) continue;

    const sectionTitle = headingPath[headingPath.length - 1] ?? "Markdown table";
    const nearbyText = cleanText((lines[i - 1] ?? "") + " " + (lines[j] ?? ""));

    candidates.push(
      createCandidate({
        id: makeId(indexOffset + candidates.length),
        kind: "markdown-table",
        sourceUrl,
        sourceType,
        matrix,
        headingPath,
        sectionTitle,
        nearbyAdvisoryText: nearbyText,
      }),
    );
    i = j;
  }

  return candidates;
}

function discoverAdvisorySections(
  $: cheerio.CheerioAPI,
  sourceUrl: string,
  sourceType: SourceType,
  indexOffset: number,
): CandidateSection[] {
  const candidates: CandidateSection[] = [];

  $("h1, h2, h3, h4").each((_, node) => {
    const title = cleanText($(node).text());
    if (!/(size|taille|fit|measure|guide)/i.test(title)) return;

    const siblings = $(node).nextAll().slice(0, 4);
    const hasStructuredTable = siblings.filter("table, [role='table']").length > 0;
    if (hasStructuredTable) return;

    const nearby = cleanText(siblings.text());
    if (!nearby) return;

    candidates.push(
      createCandidate({
        id: makeId(indexOffset + candidates.length),
        kind: "advisory-text",
        sourceUrl,
        sourceType,
        matrix: [[title], [nearby]],
        headingPath: [title],
        sectionTitle: title,
        nearbyAdvisoryText: nearby,
      }),
    );
  });

  return candidates;
}

function dedupeCandidates(candidates: CandidateSection[]): CandidateSection[] {
  const bySignature = new Map<string, CandidateSection>();

  for (const candidate of candidates) {
    const signature = [
      candidate.kind,
      candidate.sectionTitle,
      candidate.visibleColumnLabels.join("||"),
      candidate.visibleRowLabels.join("||"),
    ].join("::");

    if (!bySignature.has(signature)) {
      bySignature.set(signature, candidate);
    }
  }

  return Array.from(bySignature.values()).map((candidate, index) => ({
    ...candidate,
    id: makeId(index),
  }));
}

export function discoverCandidateSections(args: {
  html: string;
  markdown: string;
  sourceUrl: string;
}): { sourceType: SourceType; candidates: CandidateSection[] } {
  const $ = cheerio.load(args.html);
  const htmlTables = $("table").toArray();
  const ariaTables = $('[role="table"]').toArray();
  const provisionalSourceType = inferPageSourceType(
    args.sourceUrl,
    htmlTables.length + ariaTables.length,
  );

  const htmlCandidates = htmlTables.map((table, index) => {
    const headingPath = collectHeadingPath($, table);
    const sectionTitle =
      headingPath.slice(-1)[0] ||
      cleanText($(table).attr("aria-label") ?? "") ||
      "HTML table";

    return createCandidate({
      id: makeId(index),
      kind: "html-table",
      sourceUrl: args.sourceUrl,
      sourceType: provisionalSourceType,
      matrix: extractHtmlTableMatrix($, table),
      headingPath,
      sectionTitle,
      subheading: collectSubheading($, table),
      nearbyAdvisoryText: collectNearbyText($, table),
    });
  });

  const ariaCandidates = ariaTables.map((table, index) => {
    const headingPath = collectHeadingPath($, table);
    const sectionTitle =
      headingPath.slice(-1)[0] ||
      cleanText($(table).attr("aria-label") ?? "") ||
      "ARIA table";

    return createCandidate({
      id: makeId(htmlCandidates.length + index),
      kind: "aria-grid",
      sourceUrl: args.sourceUrl,
      sourceType: provisionalSourceType,
      matrix: extractAriaGridMatrix($, table),
      headingPath,
      sectionTitle,
      subheading: collectSubheading($, table),
      nearbyAdvisoryText: collectNearbyText($, table),
    });
  });

  const markdownCandidates = discoverMarkdownTables(
    args.markdown,
    args.sourceUrl,
    provisionalSourceType,
    htmlCandidates.length + ariaCandidates.length,
  );

  const advisoryCandidates = discoverAdvisorySections(
    $,
    args.sourceUrl,
    provisionalSourceType,
    htmlCandidates.length + ariaCandidates.length + markdownCandidates.length,
  );

  const deduped = dedupeCandidates(
    [...htmlCandidates, ...ariaCandidates, ...markdownCandidates, ...advisoryCandidates].filter(
      (candidate) =>
        candidate.matrix.length >= 2 &&
        candidate.matrix.some((row) => row.some(Boolean)),
    ),
  );

  const finalSourceType = inferPageSourceType(args.sourceUrl, deduped.length);
  return {
    sourceType: finalSourceType,
    candidates: deduped.map((candidate) => ({
      ...candidate,
      sourceType:
        candidate.detectedCategory === "generic-body-guide"
          ? "generic-body-guide"
          : finalSourceType,
    })),
  };
}
