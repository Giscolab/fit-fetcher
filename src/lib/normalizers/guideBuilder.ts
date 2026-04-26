import type {
  Brand,
  BrandSource,
  CandidateExtraction,
  CandidateSection,
  GeneratedGuide,
  GarmentCategory,
  Guide,
  ShoppingAssistantDimension,
  ShoppingAssistantGarmentCategory,
  ShoppingAssistantImportPayload,
  ShoppingAssistantMeasurementRange,
  ShoppingAssistantSizeGuideRow,
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
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
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
}): StrictSizeGuideOutput | { error: "NO_VALID_SIZE_GUIDE"; reason: string } {
  if (args.garmentCategory !== "tshirts" || args.sizeSystem !== "INT") {
    return {
      error: "NO_VALID_SIZE_GUIDE",
      reason:
        "L'export strict historique ne couvre que les hauts/t-shirts en tailles internationales.",
    };
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

const SHOPPING_ASSISTANT_CATEGORY_MAP: Partial<
  Record<GarmentCategory, ShoppingAssistantGarmentCategory>
> = {
  tshirts: "tshirt",
  shirts: "chemise",
  hoodies: "hoodie",
  jackets: "veste_legere",
  pants: "pantalon",
  jeans: "jean",
  shorts: "short",
  shoes: "socks",
  "generic-body-guide": "tshirt",
};

function shoppingAssistantCategory(category: GarmentCategory): ShoppingAssistantGarmentCategory {
  return SHOPPING_ASSISTANT_CATEGORY_MAP[category] ?? "tshirt";
}

function shoppingAssistantSizeSystem(sizeSystem: SizeSystem): Exclude<SizeSystem, "BRA"> {
  if (sizeSystem === "BRA") return "INT";
  if (sizeSystem === "FOOTWEAR") return "FOOTWEAR";
  return sizeSystem;
}

function range(
  min: number | undefined,
  max: number | undefined,
  unit: "cm" | "mm",
  sourceNote: string,
): ShoppingAssistantMeasurementRange | null {
  if (min == null && max == null) return null;
  return {
    min: min ?? null,
    max: max ?? null,
    target: null,
    unit,
    sourceNote,
  };
}

function mmRangeFromCm(
  min: number | undefined,
  max: number | undefined,
  sourceNote: string,
): ShoppingAssistantMeasurementRange | null {
  const toMm = (value: number | undefined) => (value == null ? undefined : Math.round(value * 10));
  return range(toMm(min), toMm(max), "mm", sourceNote);
}

function addDimension(
  dimensions: Partial<Record<ShoppingAssistantDimension, ShoppingAssistantMeasurementRange>>,
  key: ShoppingAssistantDimension,
  value: ShoppingAssistantMeasurementRange | null,
) {
  if (value) dimensions[key] = value;
}

function buildShoppingAssistantGuide(args: {
  brand: Brand;
  source: BrandSource;
  guide: Guide;
  candidate: CandidateSection;
  extraction: CandidateExtraction;
}): {
  payload: ShoppingAssistantImportPayload;
  warnings: ValidationIssue[];
} {
  const warnings: ValidationIssue[] = [];
  const now = args.guide.sourceTraceChain[0]?.url ? args.brand.updatedAt : new Date().toISOString();
  const guideId = `sa-${args.guide.id}`;
  const sourceNote = `Extraction Fit Fetcher depuis ${args.candidate.sourceUrl}`;
  const rows = args.guide.rows.map((row, index) => {
    const dimensions: ShoppingAssistantSizeGuideRow["dimensions"] = {};

    addDimension(dimensions, "chestCm", range(row.chestCmMin, row.chestCmMax, "cm", sourceNote));
    addDimension(dimensions, "waistCm", range(row.waistCmMin, row.waistCmMax, "cm", sourceNote));
    addDimension(dimensions, "seatHipsCm", range(row.hipsCmMin, row.hipsCmMax, "cm", sourceNote));
    addDimension(dimensions, "heightCm", range(row.heightCmMin, row.heightCmMax, "cm", sourceNote));
    addDimension(
      dimensions,
      "footLengthMm",
      mmRangeFromCm(row.footLengthCmMin, row.footLengthCmMax, sourceNote),
    );

    const ignoredFields = [
      row.inseamCmMin != null || row.inseamCmMax != null ? "inseam" : null,
      row.outseamCmMin != null || row.outseamCmMax != null ? "outseam" : null,
      row.neckCmMin != null || row.neckCmMax != null ? "neck" : null,
      row.shoulderCmMin != null || row.shoulderCmMax != null ? "shoulder" : null,
      row.sleeveCmMin != null || row.sleeveCmMax != null ? "sleeve" : null,
      row.footWidthCmMin != null || row.footWidthCmMax != null ? "footWidth" : null,
    ].filter((field): field is string => Boolean(field));

    if (ignoredFields.length > 0) {
      warnings.push({
        code: "shopping-assistant-dimensions-ignored",
        severity: "warning",
        message: `Certaines mesures source ne sont pas dans le schéma actuel du logiciel principal: ${ignoredFields.join(", ")}.`,
        candidateId: args.candidate.id,
        details: ignoredFields,
      });
    }

    return {
      id: `${guideId}-row-${index + 1}`,
      guideId,
      label: row.canonicalLabel || row.originalLabel,
      sortOrder: index,
      dimensions,
      notes: [
        row.fitVariant !== "standard" ? `Variante: ${row.fitVariant}.` : "",
        row.evidenceRowLabel && row.evidenceRowLabel !== row.canonicalLabel
          ? `Libellé source: ${row.evidenceRowLabel}.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  });
  const isComplete =
    rows.length > 0 && rows.every((row) => Object.keys(row.dimensions).length >= 2);

  if (!SHOPPING_ASSISTANT_CATEGORY_MAP[args.guide.garmentCategory]) {
    warnings.push({
      code: "shopping-assistant-category-fallback",
      severity: "warning",
      message: `La catégorie source ${args.guide.garmentCategory} a été repliée vers tshirt pour cohabiter avec le schéma du logiciel principal.`,
      candidateId: args.candidate.id,
    });
  }

  return {
    payload: {
      brand: {
        ...args.brand,
        notes: [
          args.brand.notes,
          "Import réel généré par Fit Fetcher pour cohabitation avec Size Intelligence Studio.",
        ]
          .filter(Boolean)
          .join(" "),
      },
      guide: {
        id: guideId,
        brandId: args.brand.id,
        name: args.guide.name,
        garmentCategory: shoppingAssistantCategory(args.guide.garmentCategory),
        sizeSystem: shoppingAssistantSizeSystem(args.guide.sizeSystem),
        fabricStretch: args.guide.fabricStretch,
        fitNotes: [
          `Section source: ${args.guide.sourceSectionTitle}.`,
          `Audience détectée: ${args.guide.sourceAudience}.`,
          `Statut validation Fit Fetcher: ${args.guide.validationStatus}.`,
        ].join(" "),
        fabricNotes: "Stretch textile non inféré depuis la page; valeur conservatrice.",
        sourceType: "json_import",
        sourceName: "Fit Fetcher",
        sourceUrl: args.guide.sourceUrl,
        isSample: false,
        isComplete,
        uncertainty: Math.max(0.05, Math.min(0.95, 1 - args.extraction.extractionConfidence)),
        rows,
        createdAt: now,
        updatedAt: now,
      },
    },
    warnings,
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
    fitVariantSupport: Array.from(new Set(args.rows.map((row) => row.fitVariant).filter(Boolean))),
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
  const shoppingAssistant = buildShoppingAssistantGuide({
    brand,
    source: args.source,
    guide,
    candidate: args.candidate,
    extraction: args.extraction,
  });

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
    shoppingAssistantGuide: shoppingAssistant.payload,
    shoppingAssistantWarnings: shoppingAssistant.warnings,
  };
}

export function guideFilename(g: GeneratedGuide): string {
  return `${slug(g.brand.name)}_${slug(g.guide.garmentCategory)}_${slug(g.guide.sizeSystem)}.json`;
}

export function shoppingAssistantGuideFilename(g: GeneratedGuide): string {
  return `${slug(g.brand.name)}_${slug(g.shoppingAssistantGuide.guide.garmentCategory)}_${slug(g.shoppingAssistantGuide.guide.sizeSystem)}_shopping-assistant.json`;
}
