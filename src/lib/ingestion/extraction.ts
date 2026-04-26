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

function normalizeMatrix(matrix: string[][]): string[][] {
  if (!matrix.length) return [];
  const width = Math.max(...matrix.map((row) => row.length));
  return matrix.map((row) => normalizeRow(row, width));
}

function strategyForCandidate(candidate: CandidateSection): CandidateExtraction["strategy"] {
  switch (candidate.kind) {
    case "html-table":
      return "table";
    case "aria-grid":
      return "aria-grid";
    case "markdown-table":
    case "markdown-grid":
      return "markdown-table";
    case "div-grid":
      return "table";
    default:
      return "none";
  }
}

function createEmptyRow(label: string): SizeRow {
  const canonical = canonicalizeSizeLabel(label);
  return {
    label,
    originalLabel: label,
    canonicalLabel: canonical.canonicalLabel,
    fitVariant: canonical.fitVariant,
    evidenceRowLabel: label,
    rawMeasurements: {},
  };
}

function applyMeasurement(
  row: SizeRow,
  field: MeasurementField,
  rawCell: string,
  header: string,
  fallbackUnit: CandidateSection["originalUnitSystem"],
): boolean {
  const parsed = parseMeasurementCell(rawCell, header, fallbackUnit);
  if (!parsed) return false;

  row.rawMeasurements[field] = rawCell;
  const [minKey, maxKey] = FIELD_TO_ROW_KEYS[field];
  (row as Record<string, number | string | object>)[minKey as string] = parsed[0];
  (row as Record<string, number | string | object>)[maxKey as string] = parsed[1];
  return true;
}

function buildRowsFromSizeRows(candidate: CandidateSection): {
  rows: SizeRow[];
  extractedFieldKeys: MeasurementField[];
} {
  const matrix = normalizeMatrix(candidate.matrix);
  const headerRow = matrix[0] ?? [];
  const bodyRows = matrix.slice(1);
  const fieldMap = headerRow.map((header) => fieldFromHeader(header));
  const rows: SizeRow[] = [];
  const extractedFields = new Set<MeasurementField>();

  for (const rawRow of bodyRows) {
    const label = rawRow[0]?.trim() ?? "";
    if (!label || !isSizeLikeLabel(label)) continue;

    const nextRow = createEmptyRow(label);
    let hasMeasure = false;

    for (let i = 1; i < rawRow.length; i++) {
      const field = fieldMap[i];
      const cell = rawRow[i]?.trim() ?? "";
      if (!field || !cell) continue;
      if (
        applyMeasurement(nextRow, field, cell, headerRow[i] ?? "", candidate.originalUnitSystem)
      ) {
        extractedFields.add(field);
        hasMeasure = true;
      }
    }

    if (hasMeasure) {
      rows.push(nextRow);
    }
  }

  return {
    rows,
    extractedFieldKeys: Array.from(extractedFields),
  };
}

function buildRowsFromSizeColumns(candidate: CandidateSection): {
  rows: SizeRow[];
  extractedFieldKeys: MeasurementField[];
} {
  const matrix = normalizeMatrix(candidate.matrix);
  const headerRow = matrix[0] ?? [];
  const bodyRows = matrix.slice(1);
  const sizeLabels = headerRow.slice(1);
  const rows = new Map<number, SizeRow>();
  const extractedFields = new Set<MeasurementField>();

  for (let columnIndex = 1; columnIndex < headerRow.length; columnIndex++) {
    const label = sizeLabels[columnIndex - 1]?.trim() ?? "";
    if (!label || !isSizeLikeLabel(label)) continue;
    rows.set(columnIndex, createEmptyRow(label));
  }

  for (const bodyRow of bodyRows) {
    const stub = bodyRow[0]?.trim() ?? "";
    const field = fieldFromHeader(stub);
    if (!field) continue;

    for (let columnIndex = 1; columnIndex < bodyRow.length; columnIndex++) {
      const row = rows.get(columnIndex);
      const cell = bodyRow[columnIndex]?.trim() ?? "";
      if (!row || !cell) continue;

      if (applyMeasurement(row, field, cell, stub, candidate.originalUnitSystem)) {
        extractedFields.add(field);
      }
    }
  }

  return {
    rows: Array.from(rows.values()).filter((row) => Object.keys(row.rawMeasurements).length > 0),
    extractedFieldKeys: Array.from(extractedFields),
  };
}

function buildRowsFromMatrix(candidate: CandidateSection): {
  rows: SizeRow[];
  extractedFieldKeys: MeasurementField[];
} {
  if (!candidate.isTabular || candidate.matrix.length < 2) {
    return { rows: [], extractedFieldKeys: [] };
  }

  if (candidate.matrixOrientation === "size-rows") {
    return buildRowsFromSizeRows(candidate);
  }

  if (candidate.matrixOrientation === "size-columns") {
    return buildRowsFromSizeColumns(candidate);
  }

  if (candidate.matrixOrientation === "conversion-grid") {
    return { rows: [], extractedFieldKeys: [] };
  }

  const fallbackRows = buildRowsFromSizeRows(candidate);
  if (fallbackRows.rows.length > 0) return fallbackRows;
  return buildRowsFromSizeColumns(candidate);
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

  return {
    candidateId: args.candidate.id,
    strategy: "none",
    rows: [],
    extractedFieldKeys: [],
    extractionConfidence: 0.1,
    validationStatus: "rejected",
    validationErrors: [],
    warnings: [
      {
        code: "deterministic-extraction-only",
        message:
          "Rejected because the table could not be extracted deterministically without guessing.",
        severity: "warning" as const,
        candidateId: args.candidate.id,
      },
    ],
  };
}
