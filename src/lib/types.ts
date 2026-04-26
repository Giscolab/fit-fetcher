export const GARMENT_CATEGORIES = [
  "tshirts",
  "polo",
  "shirts",
  "sweaters",
  "hoodies",
  "jackets",
  "coats",
  "pants",
  "jeans",
  "shorts",
  "underwear",
  "socks",
  "leggings",
  "bras",
  "shoes",
  "generic-body-guide",
] as const;
export type GarmentCategory = (typeof GARMENT_CATEGORIES)[number];

export const DETECTED_GARMENT_CATEGORIES = [
  ...GARMENT_CATEGORIES,
  "tops",
  "bottoms",
  "unknown",
] as const;
export type DetectedGarmentCategory =
  (typeof DETECTED_GARMENT_CATEGORIES)[number];

export const SIZE_SYSTEMS = [
  "FR",
  "EU",
  "US",
  "UK",
  "IT",
  "INT",
  "WAIST_INSEAM",
  "FOOTWEAR",
  "SOCK",
  "BRA",
] as const;
export type SizeSystem = (typeof SIZE_SYSTEMS)[number];

export const DETECTED_SIZE_SYSTEMS = [
  ...SIZE_SYSTEMS,
  "NUMERIC",
  "UNKNOWN",
] as const;
export type DetectedSizeSystem = (typeof DETECTED_SIZE_SYSTEMS)[number];

export const SOURCE_TYPES = [
  "generic-multi-guide-page",
  "category-specific-page",
  "product-page-size-guide",
  "generic-body-guide",
  "guide-hub-page",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const DOCUMENT_KINDS = [
  "direct-guide-page",
  "multi-guide-page",
  "guide-hub-page",
  "irrelevant",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const AUDIENCES = ["men", "women", "kids", "unisex", "unknown"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const FIT_VARIANTS = [
  "standard",
  "regular",
  "tall",
  "petite",
  "unknown",
] as const;
export type FitVariant = (typeof FIT_VARIANTS)[number];

export const MEASUREMENT_UNITS = ["cm", "in", "mixed", "unknown"] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

export const GUIDE_FIELDS = [
  "chest",
  "waist",
  "hips",
  "inseam",
  "outseam",
  "height",
  "sleeve",
  "neck",
  "shoulder",
  "footLength",
  "footWidth",
] as const;
export type MeasurementField = (typeof GUIDE_FIELDS)[number];

export const CANDIDATE_KINDS = [
  "html-table",
  "aria-grid",
  "markdown-table",
  "div-grid",
  "markdown-grid",
  "advisory-text",
] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

export const MATRIX_ORIENTATIONS = [
  "size-rows",
  "size-columns",
  "conversion-grid",
  "unknown",
] as const;
export type MatrixOrientation = (typeof MATRIX_ORIENTATIONS)[number];

export const CATEGORY_MAPPING_MODES = [
  "exact",
  "curated-broad-top",
  "generic-body",
  "unknown",
] as const;
export type CategoryMappingMode = (typeof CATEGORY_MAPPING_MODES)[number];

export const VALIDATION_STATUSES = [
  "accepted",
  "warning",
  "rejected",
  "ambiguous",
] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export interface BrandSource {
  brand: string;
  name?: string;
  size_guide_url: string;
  audience?: string;
  garmentCategory?: string;
  sizeSystem?: string;
  fallbackSizeSystem?: string;
  fallbackUrls?: string[];
}

export interface Brand {
  id: string;
  name: string;
  country: string | null;
  website: string | null;
  isSample: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface SizeRow {
  label: string;
  originalLabel: string;
  canonicalLabel: string;
  fitVariant: FitVariant;
  evidenceRowLabel: string;
  rawMeasurements: Partial<Record<MeasurementField, string>>;
  chestCmMin?: number;
  chestCmMax?: number;
  waistCmMin?: number;
  waistCmMax?: number;
  hipsCmMin?: number;
  hipsCmMax?: number;
  inseamCmMin?: number;
  inseamCmMax?: number;
  outseamCmMin?: number;
  outseamCmMax?: number;
  heightCmMin?: number;
  heightCmMax?: number;
  neckCmMin?: number;
  neckCmMax?: number;
  shoulderCmMin?: number;
  shoulderCmMax?: number;
  sleeveCmMin?: number;
  sleeveCmMax?: number;
  footLengthCmMin?: number;
  footLengthCmMax?: number;
  footWidthCmMin?: number;
  footWidthCmMax?: number;
}

export interface StrictSizeGuideSize {
  label: string;
  chest_cm: number | null;
  waist_cm: number | null;
}

export interface StrictSizeGuideOutput {
  brand: string;
  garmentCategory: "tshirts";
  sizeSystem: "INT";
  sizes: StrictSizeGuideSize[];
  source_url: string;
  confidence: number;
}

export interface StrictSizeGuideFailure {
  error: "NO_VALID_SIZE_GUIDE";
  reason: string;
}

export const SHOPPING_ASSISTANT_GARMENT_CATEGORIES = [
  "tshirt",
  "polo",
  "chemise",
  "pull",
  "hoodie",
  "veste_legere",
  "manteau",
  "jean",
  "pantalon",
  "chino",
  "cargo",
  "short",
  "boxer",
  "slip",
  "chaussette",
  "parka",
  "doudoune",
  "boxers_or_underwear",
  "socks",
  "tshirts",
  "shirts",
  "sweaters",
  "hoodies",
  "jackets",
  "coats",
  "jeans",
  "trousers",
  "shorts",
] as const;
export type ShoppingAssistantGarmentCategory =
  (typeof SHOPPING_ASSISTANT_GARMENT_CATEGORIES)[number];

export const SHOPPING_ASSISTANT_DIMENSIONS = [
  "chestCm",
  "waistCm",
  "stomachCm",
  "seatHipsCm",
  "bicepsCm",
  "forearmCm",
  "thighCm",
  "calfCm",
  "footLengthMm",
  "heightCm",
] as const;
export type ShoppingAssistantDimension =
  (typeof SHOPPING_ASSISTANT_DIMENSIONS)[number];

export interface ShoppingAssistantMeasurementRange {
  min: number | null;
  max: number | null;
  target: number | null;
  unit: "cm" | "mm";
  sourceNote?: string;
}

export interface ShoppingAssistantSizeGuideRow {
  id: string;
  guideId: string;
  label: string;
  sortOrder: number;
  dimensions: Partial<
    Record<ShoppingAssistantDimension, ShoppingAssistantMeasurementRange>
  >;
  notes: string;
}

export interface ShoppingAssistantBrandSizeGuide {
  id: string;
  brandId: string;
  name: string;
  garmentCategory: ShoppingAssistantGarmentCategory;
  sizeSystem: Exclude<SizeSystem, "BRA">;
  fabricStretch: "none" | "low" | "medium" | "high";
  fitNotes: string;
  fabricNotes: string;
  sourceType: "json_import";
  sourceName: string;
  sourceUrl: string | null;
  isSample: false;
  isComplete: boolean;
  uncertainty: number;
  rows: ShoppingAssistantSizeGuideRow[];
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingAssistantImportPayload {
  brand: Brand;
  guide: ShoppingAssistantBrandSizeGuide;
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
  candidateId?: string;
  details?: string[];
}

export interface SourceTraceStep {
  kind: "requested-url" | "followed-link" | "brand-fallback";
  url: string;
  label: string;
  confidence: number;
  reasons: string[];
}

export interface LinkCandidate {
  id: string;
  url: string;
  label: string;
  headingPath: string[];
  nearbyText: string;
  detectedCategory: DetectedGarmentCategory;
  detectedSizeSystem: DetectedSizeSystem;
  categoryMappingMode: CategoryMappingMode;
  categoryMappingReason?: string;
  score: number;
  reasons: string[];
  rejectionReasons: string[];
  selected: boolean;
  resolver: "generic" | "brand-fallback";
}

export interface CandidateSection {
  id: string;
  kind: CandidateKind;
  isTabular: boolean;
  sourceUrl: string;
  sourceType: SourceType;
  documentKind: DocumentKind;
  sourceTraceChain: SourceTraceStep[];
  linkOriginId?: string;
  navigationConfidence: number;
  sectionTitle: string;
  subheading?: string;
  headingPath: string[];
  audience: Audience;
  garmentFamily: "tops" | "bottoms" | "shoes" | "bras" | "body" | "unknown";
  detectedCategory: DetectedGarmentCategory;
  detectedCategoryLabel: string;
  fitVariant: FitVariant;
  detectedSizeSystem: DetectedSizeSystem;
  originalUnitSystem: MeasurementUnit;
  matrixOrientation: MatrixOrientation;
  categoryMappingMode: CategoryMappingMode;
  categoryMappingReason?: string;
  rawHeaders: string[];
  rawStubColumn: string[];
  rawSizeAxisLabels: string[];
  visibleColumnLabels: string[];
  visibleRowLabels: string[];
  nearbyAdvisoryText: string;
  rawEvidenceSnippet: string;
  matrix: string[][];
  extractionConfidence: number;
  selectionScore: number;
  matchReasons: string[];
  rejectionReasons: string[];
  warnings: string[];
}

export interface CandidateExtraction {
  candidateId: string;
  strategy: "table" | "aria-grid" | "markdown-table" | "llm" | "none";
  rows: SizeRow[];
  extractedFieldKeys: MeasurementField[];
  extractionConfidence: number;
  validationStatus: ValidationStatus;
  validationErrors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface AiFallbackAttempt {
  candidateId: string;
  status: ValidationStatus | "error";
  reason: string;
  rowsCount: number;
  extractedFieldKeys: MeasurementField[];
  score: number;
  warnings: ValidationIssue[];
  validationErrors: ValidationIssue[];
}

export interface Guide {
  id: string;
  brandId: string;
  name: string;
  garmentCategory: GarmentCategory;
  sizeSystem: SizeSystem;
  fabricStretch: "low" | "medium" | "high";
  rows: SizeRow[];
  sourceUrl: string;
  originalRequestedUrl: string;
  resolvedSourceUrl: string;
  sourceSectionTitle: string;
  sourceAudience: Audience;
  sourceCategoryLabel: string;
  sourceType: SourceType;
  documentKind: DocumentKind;
  sourceTraceChain: SourceTraceStep[];
  originalUnitSystem: MeasurementUnit;
  extractionConfidence: number;
  validationStatus: ValidationStatus;
  validationErrors: ValidationIssue[];
  warnings: ValidationIssue[];
  fitVariantSupport: FitVariant[];
  matrixOrientation: MatrixOrientation;
  categoryMappingMode: CategoryMappingMode;
  categoryMappingReason?: string;
  originalSizeLabels: string[];
  sourceHeaders: string[];
  sourceRowLabels: string[];
  rawStubColumn: string[];
  rawSizeAxisLabels: string[];
  rawEvidenceSnippet: string;
  rawExtractedFields: string[];
  rawCandidateId: string;
}

export interface GeneratedGuide {
  brand: Brand;
  guide: Guide;
  strictGuide: StrictSizeGuideOutput | StrictSizeGuideFailure;
  shoppingAssistantGuide: ShoppingAssistantImportPayload;
  shoppingAssistantWarnings: ValidationIssue[];
}

export interface IngestionPipelineReport {
  fetchedUrl: string;
  resolvedSourceUrl: string;
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
  sourceType: SourceType;
  documentKind: DocumentKind;
  documentReasoning: string[];
  sourceTraceChain: SourceTraceStep[];
  followedUrl?: string;
  linkCandidates: LinkCandidate[];
  navigationConfidence: number;
  discoveredCandidates: CandidateSection[];
  selectedCandidateId?: string;
  rejectedCandidateIds: string[];
  selectionReasoning: string[];
  candidateExtractions: CandidateExtraction[];
  aiFallbackAttempt?: AiFallbackAttempt;
  validationStatus: ValidationStatus;
  validationErrors: ValidationIssue[];
  warnings: ValidationIssue[];
  manualReviewRecommended: boolean;
}

export type BrandStatus = "pending" | "running" | "done" | "review" | "error";

export interface BrandResult {
  source: BrandSource;
  status: BrandStatus;
  message?: string;
  rowsCount?: number;
  guide?: GeneratedGuide;
  pipeline?: IngestionPipelineReport;
  logs: string[];
}
