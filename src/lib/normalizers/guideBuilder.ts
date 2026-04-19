import type {
  Brand,
  BrandSource,
  GarmentCategory,
  GeneratedGuide,
  Guide,
  SizeRow,
  SizeSystem,
} from "@/lib/types";

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uid(): string {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
  );
}

function safeWebsite(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Build the importer-ready { brand, guide } payload. */
export function buildGeneratedGuide(args: {
  source: BrandSource;
  rows: SizeRow[];
}): GeneratedGuide {
  const { source, rows } = args;
  const garmentCategory: GarmentCategory =
    (source.garmentCategory as GarmentCategory) ?? "tshirts";
  const sizeSystem: SizeSystem = (source.sizeSystem as SizeSystem) ?? "INT";
  const now = new Date().toISOString();
  const brandId = `brand-${slug(source.brand)}`;

  const brand: Brand = {
    id: brandId,
    name: source.brand,
    country: null,
    website: safeWebsite(source.size_guide_url),
    isSample: false,
    notes: "",
    createdAt: now,
    updatedAt: now,
  };

  const guide: Guide = {
    id: `guide-${slug(source.brand)}-${slug(garmentCategory)}-${slug(sizeSystem)}-${uid()}`,
    brandId,
    name:
      source.name && source.name.trim()
        ? source.name
        : `${source.brand} – ${garmentCategory} (${sizeSystem})`,
    garmentCategory,
    sizeSystem,
    fabricStretch: "low",
    rows,
  };

  return { brand, guide };
}

/** Suggested filename for a generated guide. */
export function guideFilename(g: GeneratedGuide): string {
  return `${slug(g.brand.name)}_${slug(g.guide.garmentCategory)}_${slug(g.guide.sizeSystem)}.json`;
}
