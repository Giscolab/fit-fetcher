import type {
  Brand,
  BrandSource,
  CandidateExtraction,
  CandidateSection,
  GeneratedGuide,
  GarmentCategory,
  Guide,
  SizeRow,
  SizeSystem,
  StrictSizeGuideOutput,
  ValidationIssue,
  ValidationStatus,
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

function strictScalarValue(min?: number, max?: number): number | null {
  if (min == null && max == null) return null;
  return max ?? min ?? null;
}

function buildStrictGuide(args: {
  source: BrandSource;
  rows: SizeRow[];
  garmentCategory: GarmentCategory;
  sizeSystem: SizeSystem;
  candidate: CandidateSection;
  extraction: CandidateExtraction;
}): StrictSizeGuideOutput {
  if (args.garmentCategory !== "tshirts" || args.sizeSystem !== "INT") {
    throw new Error("NO_VALID_SIZE_GUIDE: strict export only supports tshirts / INT.");
  }

  return {
    brand: args.source.brand,
    garmentCategory: "tshirts",
    sizeSystem: "INT",
    sizes: args.rows.map((row) => ({
      label: row.canonicalLabel,
      chest_cm: strictScalarValue(row.chestCmMin, row.chestCmMax),
      waist_cm: strictScalarValue(row.waistCmMin, row.waistCmMax),
    })),
    source_url: args.candidate.sourceUrl,
    confidence: Math.round(args.extraction.extractionConfidence * 100) / 100,
  };
}

export function buildGeneratedGuide(args: {
  source: BrandSource;
  rows: SizeRow[];
  garmentCategory: GarmentCategory;
  sizeSystem: SizeSystem;
  candidate: CandidateSection;
  extraction: CandidateExtraction;
  validationStatus: ValidationStatus;
  validationErrors: ValidationIssue[];
  warnings: ValidationIssue[];
}): GeneratedGuide {
  const now = new Date().toISOString();
  const brandId = `brand-${slug(args.source.brand)}`;

  const brand: Brand = {
    id: brandId,
    name: args.source.brand,
    country: null,
    website: safeWebsite(args.source.size_guide_url),
    isSample: false,
    notes: "",
    createdAt: now,
    updatedAt: now,
  };

  const guide: Guide = {
    id: `guide-${slug(args.source.brand)}-${slug(args.garmentCategory)}-${slug(args.sizeSystem)}-${uid()}`,
    brandId,
    name:
      args.source.name && args.source.name.trim()
        ? args.source.name
        : `${args.source.brand} – ${args.garmentCategory} (${args.sizeSystem})`,
    garmentCategory: args.garmentCategory,
    sizeSystem: args.sizeSystem,
    fabricStretch: "low",
    rows: args.rows,
    sourceUrl: args.candidate.sourceUrl,
    originalRequestedUrl: args.source.size_guide_url,
    resolvedSourceUrl: args.candidate.sourceUrl,
    sourceSectionTitle: args.candidate.sectionTitle,
    sourceAudience: args.candidate.audience,
    sourceCategoryLabel: args.candidate.detectedCategoryLabel,
    sourceType: args.candidate.sourceType,
    documentKind: args.candidate.documentKind,
    sourceTraceChain: args.candidate.sourceTraceChain,
    originalUnitSystem: args.candidate.originalUnitSystem,
    extractionConfidence: args.extraction.extractionConfidence,
    validationStatus: args.validationStatus,
    validationErrors: args.validationErrors,
    warnings: args.warnings,
    fitVariantSupport: Array.from(
      new Set(args.rows.map((row) => row.fitVariant).filter(Boolean)),
    ),
    matrixOrientation: args.candidate.matrixOrientation,
    categoryMappingMode: args.candidate.categoryMappingMode,
    categoryMappingReason: args.candidate.categoryMappingReason,
    originalSizeLabels: args.rows.map((row) => row.originalLabel),
    sourceHeaders: args.candidate.rawHeaders,
    sourceRowLabels: args.candidate.rawSizeAxisLabels,
    rawStubColumn: args.candidate.rawStubColumn,
    rawSizeAxisLabels: args.candidate.rawSizeAxisLabels,
    rawEvidenceSnippet: args.candidate.rawEvidenceSnippet,
    rawExtractedFields: args.extraction.extractedFieldKeys,
    rawCandidateId: args.candidate.id,
  };

  return {
    brand,
    guide,
    strictGuide: buildStrictGuide({
      source: args.source,
      rows: args.rows,
      garmentCategory: args.garmentCategory,
      sizeSystem: args.sizeSystem,
      candidate: args.candidate,
      extraction: args.extraction,
    }),
  };
}

export function guideFilename(g: GeneratedGuide): string {
  return `${slug(g.brand.name)}_${slug(g.guide.garmentCategory)}_${slug(g.guide.sizeSystem)}.json`;
}
