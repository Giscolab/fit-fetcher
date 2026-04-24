import { FIELD_TO_ROW_KEYS } from "@/lib/ingestion/measurements";
import type {
  CandidateSection,
  FitVariant,
  GarmentCategory,
  MeasurementField,
  SizeRow,
  SizeSystem,
} from "@/lib/types";
import { scrapeWithFirecrawlStructured } from "@/lib/utils/firecrawl";

interface FirecrawlLlmRow {
  original_label: string | null;
  canonical_label: string | null;
  fit_variant: FitVariant | null;
  evidence_row_label: string | null;
  chest_cm_min?: number | null;
  chest_cm_max?: number | null;
  waist_cm_min?: number | null;
  waist_cm_max?: number | null;
  hips_cm_min?: number | null;
  hips_cm_max?: number | null;
  inseam_cm_min?: number | null;
  inseam_cm_max?: number | null;
  outseam_cm_min?: number | null;
  outseam_cm_max?: number | null;
  height_cm_min?: number | null;
  height_cm_max?: number | null;
  neck_cm_min?: number | null;
  neck_cm_max?: number | null;
  shoulder_cm_min?: number | null;
  shoulder_cm_max?: number | null;
  sleeve_cm_min?: number | null;
  sleeve_cm_max?: number | null;
  foot_length_cm_min?: number | null;
  foot_length_cm_max?: number | null;
  foot_width_cm_min?: number | null;
  foot_width_cm_max?: number | null;
}

interface FirecrawlLlmResult {
  status: "ok" | "ambiguous" | "not_found";
  matched_section_title: string | null;
  reasons: string[];
  warnings: string[];
  rows: FirecrawlLlmRow[];
}

const CANDIDATE_SCHEMA = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["ok", "ambiguous", "not_found"],
    },
    matched_section_title: { type: "string" },
    reasons: {
      type: "array",
      items: { type: "string" },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original_label: { type: "string" },
          canonical_label: { type: "string" },
          fit_variant: {
            type: "string",
            enum: ["standard", "regular", "tall", "petite", "unknown"],
          },
          evidence_row_label: { type: "string" },
          chest_cm_min: { type: "number" },
          chest_cm_max: { type: "number" },
          waist_cm_min: { type: "number" },
          waist_cm_max: { type: "number" },
          hips_cm_min: { type: "number" },
          hips_cm_max: { type: "number" },
          inseam_cm_min: { type: "number" },
          inseam_cm_max: { type: "number" },
          outseam_cm_min: { type: "number" },
          outseam_cm_max: { type: "number" },
          height_cm_min: { type: "number" },
          height_cm_max: { type: "number" },
          neck_cm_min: { type: "number" },
          neck_cm_max: { type: "number" },
          shoulder_cm_min: { type: "number" },
          shoulder_cm_max: { type: "number" },
          sleeve_cm_min: { type: "number" },
          sleeve_cm_max: { type: "number" },
          foot_length_cm_min: { type: "number" },
          foot_length_cm_max: { type: "number" },
          foot_width_cm_min: { type: "number" },
          foot_width_cm_max: { type: "number" },
        },
        required: [
          "original_label",
          "canonical_label",
          "fit_variant",
          "evidence_row_label",
        ],
      },
    },
  },
  required: ["status", "reasons", "warnings", "rows"],
} as const;

function buildPrompt(args: {
  candidate: CandidateSection;
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
}): string {
  const allowedFields =
    args.requestedCategory === "shoes"
      ? "foot_length_cm_min, foot_length_cm_max, foot_width_cm_min, foot_width_cm_max"
      : args.requestedCategory === "generic-body-guide"
        ? "chest, waist, hips, inseam, outseam, height, neck, shoulder, sleeve"
        : args.requestedCategory &&
            ["pants", "jeans", "shorts", "leggings"].includes(args.requestedCategory)
          ? "waist, hips, inseam, outseam, height"
          : "chest, waist, hips, height, sleeve, neck, shoulder";

  return [
    "Extract rows only from one exact size-guide section on the page.",
    `Target section title: ${args.candidate.sectionTitle}.`,
    args.candidate.subheading ? `Target subheading: ${args.candidate.subheading}.` : "",
    args.candidate.headingPath.length
      ? `Heading path: ${args.candidate.headingPath.join(" > ")}.`
      : "",
    args.candidate.visibleColumnLabels.length
      ? `Visible column labels: ${args.candidate.visibleColumnLabels.join(", ")}.`
      : "",
    args.candidate.visibleRowLabels.length
      ? `Visible row labels: ${args.candidate.visibleRowLabels.join(", ")}.`
      : "",
    args.requestedCategory
      ? `Requested garment category: ${args.requestedCategory}.`
      : "Requested garment category is unknown.",
    args.requestedSizeSystem
      ? `Requested size system: ${args.requestedSizeSystem}.`
      : "Requested size system is unknown.",
    `Allowed measurement fields: ${allowedFields}.`,
    "Preserve each visible size label exactly in original_label and evidence_row_label.",
    "Do not invent missing sizes, variants, or measurements.",
    "Do not interpolate or smooth ranges.",
    "Do not merge data from any other section on the page.",
    "If the target section is ambiguous, missing, or does not clearly match, return status=ambiguous or status=not_found with rows=[].",
    "If a row is not explicitly visible in the target section, do not return it.",
    "Use centimetres only in the numeric fields.",
  ]
    .filter(Boolean)
    .join(" ");
}

function toSizeRow(row: FirecrawlLlmRow): SizeRow | null {
  const originalLabel = row.original_label?.trim() ?? "";
  const canonicalLabel = row.canonical_label?.trim() ?? "";
  if (!originalLabel || !canonicalLabel) return null;

  const nextRow: SizeRow = {
    label: originalLabel,
    originalLabel,
    canonicalLabel,
    fitVariant: row.fit_variant ?? "unknown",
    evidenceRowLabel: row.evidence_row_label?.trim() || originalLabel,
    rawMeasurements: {},
  };

  const fieldEntries: Array<
    [MeasurementField, number | null | undefined, number | null | undefined]
  > = [
    ["chest", row.chest_cm_min, row.chest_cm_max],
    ["waist", row.waist_cm_min, row.waist_cm_max],
    ["hips", row.hips_cm_min, row.hips_cm_max],
    ["inseam", row.inseam_cm_min, row.inseam_cm_max],
    ["outseam", row.outseam_cm_min, row.outseam_cm_max],
    ["height", row.height_cm_min, row.height_cm_max],
    ["neck", row.neck_cm_min, row.neck_cm_max],
    ["shoulder", row.shoulder_cm_min, row.shoulder_cm_max],
    ["sleeve", row.sleeve_cm_min, row.sleeve_cm_max],
    ["footLength", row.foot_length_cm_min, row.foot_length_cm_max],
    ["footWidth", row.foot_width_cm_min, row.foot_width_cm_max],
  ];

  for (const [field, minValue, maxValue] of fieldEntries) {
    if (minValue == null && maxValue == null) continue;
    const [minKey, maxKey] = FIELD_TO_ROW_KEYS[field];
    const min = minValue ?? maxValue ?? null;
    const max = maxValue ?? minValue ?? null;
    if (min == null || max == null) continue;
    (nextRow as Record<string, number | string | object>)[minKey as string] = min;
    (nextRow as Record<string, number | string | object>)[maxKey as string] = max;
  }

  return nextRow;
}

function presentFieldKeys(rows: SizeRow[]): MeasurementField[] {
  return (Object.keys(FIELD_TO_ROW_KEYS) as MeasurementField[]).filter((field) => {
    const [minKey, maxKey] = FIELD_TO_ROW_KEYS[field];
    return rows.some((row) => row[minKey] != null || row[maxKey] != null);
  });
}

export async function extractCandidateGuideWithLLM(args: {
  url: string;
  candidate: CandidateSection;
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
}): Promise<{
  rows: SizeRow[];
  extractedFieldKeys: MeasurementField[];
  warnings: string[];
  score: number;
}> {
  const extracted = await scrapeWithFirecrawlStructured<FirecrawlLlmResult>({
    url: args.url,
    schema: CANDIDATE_SCHEMA,
    prompt: buildPrompt(args),
  });

  if (!extracted || extracted.status !== "ok") {
    return {
      rows: [],
      extractedFieldKeys: [],
      warnings: extracted?.reasons ?? ["LLM could not resolve the requested section safely."],
      score: 0,
    };
  }

  const rows = extracted.rows
    .map((row) => toSizeRow(row))
    .filter((row): row is SizeRow => Boolean(row));

  return {
    rows,
    extractedFieldKeys: presentFieldKeys(rows),
    warnings: extracted.warnings ?? [],
    score: Math.min(0.8, rows.length * 0.05 + 0.3),
  };
}
