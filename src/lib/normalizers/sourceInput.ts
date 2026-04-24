import type { BrandSource } from "@/lib/types";

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeImportedCategory(value: unknown): string | undefined {
  const category = textValue(value);
  if (!category) return undefined;
  const normalized = category.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalized === "top" || normalized === "tops" ? "tshirts" : category;
}

export function normalizeBrandSourceInput(raw: unknown): BrandSource | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const target =
    record.target && typeof record.target === "object"
      ? (record.target as Record<string, unknown>)
      : {};
  const brand = textValue(record.brand);
  const sizeGuideUrl =
    textValue(record.size_guide_url) ??
    textValue(record.sizeGuideUrl) ??
    textValue(record.entry_url) ??
    textValue(record.url);

  if (!brand || !sizeGuideUrl) return null;

  return {
    brand,
    name: textValue(record.name),
    size_guide_url: sizeGuideUrl,
    garmentCategory:
      normalizeImportedCategory(record.garmentCategory) ??
      normalizeImportedCategory(record.category) ??
      normalizeImportedCategory(target.category),
    sizeSystem:
      textValue(record.sizeSystem) ??
      textValue(record.size_system) ??
      textValue(target.sizeSystem) ??
      textValue(target.size_system),
  };
}
