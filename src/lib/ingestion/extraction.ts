import { extractCandidateGuideWithLLM } from "@/lib/extractors/llm";
import {
  FIELD_TO_ROW_KEYS,
  fieldFromHeader,
  parseMeasurementCell,
} from "@/lib/ingestion/measurements";
import { canonicalizeSizeLabel, isSizeLikeLabel } from "@/lib/ingestion/taxonomy";
import type {
  CandidateExtraction,
  CandidateSection,
  GarmentCategory,
  MeasurementField,
  SizeRow,
  SizeSystem,
} from "@/lib/types";

function normalizeRow(row: string[], width: number): string[] {
  const next = [...row];
  while (next.length < width) next.push("");
  return next.slice(0, width);
}

function usesHeaderRow(matrix: string[][]): boolean {
  const firstRow = matrix[0] ?? [];
  return firstRow.some((cell, index) => {
    if (index === 0) return /size|taille/i.test(cell);
    return Boolean(fieldFromHeader(cell));
  });
}

function strategyForCandidate(
  candidate: CandidateSection,
): CandidateExtraction["strategy"] {
  switch (candidate.kind) {
    case "html-table":
      return "table";
    case "aria-grid":
      return "aria-grid";
    case "markdown-table":
      return "markdown-table";
    default:
      return "none";
  }
}

function buildRowsFromMatrix(candidate: CandidateSection): {
  rows: SizeRow[];
  extractedFieldKeys: MeasurementField[];
} {
  if (!candidate.isTabular || candidate.matrix.length < 2) {
    return { rows: [], extractedFieldKeys: [] };
  }

  const width = Math.max(...candidate.matrix.map((row) => row.length));
  const matrix = candidate.matrix.map((row) => normalizeRow(row, width));
  const headerRow = usesHeaderRow(matrix) ? matrix[0] : matrix[0];
  const bodyRows = matrix.slice(1);
  const fieldMap = headerRow.map((header) => fieldFromHeader(header));
  const rows: SizeRow[] = [];
  const extractedFields = new Set<MeasurementField>();

  for (const rawRow of bodyRows) {
    const row = normalizeRow(rawRow, headerRow.length);
    const label = row[0]?.trim() ?? "";
    if (!label || !isSizeLikeLabel(label)) continue;

    const canonical = canonicalizeSizeLabel(label);
    const nextRow: SizeRow = {
      label,
      originalLabel: label,
      canonicalLabel: canonical.canonicalLabel,
      fitVariant: canonical.fitVariant,
      evidenceRowLabel: label,
      rawMeasurements: {},
    };

    let hasMeasure = false;
    for (let i = 1; i < row.length; i++) {
      const field = fieldMap[i];
      const cell = row[i]?.trim() ?? "";
      if (!field || !cell) continue;

      nextRow.rawMeasurements[field] = cell;
      const parsed = parseMeasurementCell(
        cell,
        headerRow[i] ?? "",
        candidate.originalUnitSystem,
      );
      if (!parsed) continue;
      const [minKey, maxKey] = FIELD_TO_ROW_KEYS[field];
      (nextRow as Record<string, number | string | object>)[minKey as string] = parsed[0];
      (nextRow as Record<string, number | string | object>)[maxKey as string] = parsed[1];
      extractedFields.add(field);
      hasMeasure = true;
    }

    if (hasMeasure || label) {
      rows.push(nextRow);
    }
  }

  return {
    rows,
    extractedFieldKeys: Array.from(extractedFields),
  };
}

export async function extractCandidate(args: {
  sourceUrl: string;
  candidate: CandidateSection;
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
}): Promise<CandidateExtraction> {
  const deterministic = buildRowsFromMatrix(args.candidate);
  if (deterministic.rows.length > 0) {
    return {
      candidateId: args.candidate.id,
      strategy: strategyForCandidate(args.candidate),
      rows: deterministic.rows,
      extractedFieldKeys: deterministic.extractedFieldKeys,
      extractionConfidence: Math.min(
        0.99,
        args.candidate.extractionConfidence + deterministic.rows.length * 0.02,
      ),
      validationStatus: "warning",
      validationErrors: [],
      warnings: [],
    };
  }

  if (!args.candidate.isTabular) {
    return {
      candidateId: args.candidate.id,
      strategy: "none",
      rows: [],
      extractedFieldKeys: [],
      extractionConfidence: 0.1,
      validationStatus: "rejected",
      validationErrors: [],
      warnings: [],
    };
  }

  const llm = await extractCandidateGuideWithLLM({
    url: args.sourceUrl,
    candidate: args.candidate,
    requestedCategory: args.requestedCategory,
    requestedSizeSystem: args.requestedSizeSystem,
  });

  return {
    candidateId: args.candidate.id,
    strategy: llm.rows.length ? "llm" : "none",
    rows: llm.rows,
    extractedFieldKeys: llm.extractedFieldKeys,
    extractionConfidence: llm.rows.length ? Math.max(0.2, llm.score) : 0.1,
    validationStatus: llm.rows.length ? "warning" : "rejected",
    validationErrors: [],
    warnings: llm.warnings.map((message) => ({
      code: "llm-warning",
      message,
      severity: "warning" as const,
      candidateId: args.candidate.id,
    })),
  };
}
