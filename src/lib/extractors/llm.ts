import { scrapeWithFirecrawlJson, type FirecrawlJsonRow } from "@/lib/utils/firecrawl";
import type { SizeRow } from "@/lib/types";

/** Coerce a Firecrawl JSON row (may have nulls / inches already converted) into a SizeRow. */
function toSizeRow(r: FirecrawlJsonRow): SizeRow | null {
  const label = (r.label ?? "").toString().trim();
  if (!label) return null;

  const row: SizeRow = { label };
  const pairs: Array<[keyof SizeRow, keyof SizeRow, number | null | undefined, number | null | undefined]> = [
    ["chestCmMin", "chestCmMax", r.chest_cm_min, r.chest_cm_max],
    ["waistCmMin", "waistCmMax", r.waist_cm_min, r.waist_cm_max],
    ["hipsCmMin", "hipsCmMax", r.hips_cm_min, r.hips_cm_max],
    ["inseamCmMin", "inseamCmMax", r.inseam_cm_min, r.inseam_cm_max],
  ];

  let hasMeasure = false;
  for (const [minKey, maxKey, minVal, maxVal] of pairs) {
    const min = typeof minVal === "number" && Number.isFinite(minVal) ? minVal : undefined;
    const max = typeof maxVal === "number" && Number.isFinite(maxVal) ? maxVal : undefined;
    if (min === undefined && max === undefined) continue;
    const finalMin = min ?? max!;
    const finalMax = max ?? min!;
    (row as unknown as Record<string, number>)[minKey as string] = finalMin;
    (row as unknown as Record<string, number>)[maxKey as string] = finalMax;
    hasMeasure = true;
  }

  return hasMeasure ? row : { label };
}

export interface LlmExtractionResult {
  rows: SizeRow[];
  unit: "cm" | "in" | "unknown";
  strategy: "llm";
  score: number;
}

/** Fallback extractor: ask Firecrawl LLM to return a structured size guide. */
export async function extractSizeGuideLLM(url: string): Promise<LlmExtractionResult> {
  const result = await scrapeWithFirecrawlJson(url);
  const rows: SizeRow[] = [];
  for (const r of result.rows) {
    const sr = toSizeRow(r);
    if (sr) rows.push(sr);
  }
  return {
    rows,
    unit: result.unit_detected ?? "cm",
    strategy: "llm",
    score: rows.length,
  };
}
