export const GARMENT_CATEGORIES = [
  "tshirts",
  "shirts",
  "hoodies",
  "jackets",
  "pants",
  "jeans",
  "shorts",
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
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

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
  "advisory-text",
] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

export const VALIDATION_STATUSES = [
  "accepted",
  "warning",
  "rejected",
  "ambiguous",
] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const DOCUMENT_KINDS = [
  "direct-guide-page",
  "multi-guide-page",
  "guide-hub-page",
  "irrelevant",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface HubLinkCandidate {
  url: string;
  anchorText: string;
  score: number;
  reasons: string[];
}

export interface HopAttempt {
  url: string;
  followedFromUrl?: string;
  documentKind: DocumentKind;
  candidatesDiscovered: number;
  selectedCandidateId?: string;
  validationStatus: ValidationStatus;
  outcome: "accepted" | "rejected" | "skipped" | "fetch-error";
  errorMessage?: string;
}

export interface BrandSource {
  brand: string;
  name?: string;
  size_guide_url: string;
  garmentCategory?: string;
  sizeSystem?: string;
  gender?: "men" | "women" | "kids" | "unisex";
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

export interface ValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
  candidateId?: string;
  details?: string[];
}

export interface CandidateSection {
  id: string;
  kind: CandidateKind;
  isTabular: boolean;
  sourceUrl: string;
  sourceType: SourceType;
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

export interface Guide {
  id: string;
  brandId: string;
  name: string;
  garmentCategory: GarmentCategory;
  sizeSystem: SizeSystem;
  fabricStretch: "low" | "medium" | "high";
  rows: SizeRow[];
  sourceUrl: string;
  sourceSectionTitle: string;
  sourceAudience: Audience;
  sourceCategoryLabel: string;
  sourceType: SourceType;
  originalUnitSystem: MeasurementUnit;
  extractionConfidence: number;
  validationStatus: ValidationStatus;
  validationErrors: ValidationIssue[];
  warnings: ValidationIssue[];
  fitVariantSupport: FitVariant[];
  originalSizeLabels: string[];
  sourceHeaders: string[];
  sourceRowLabels: string[];
  rawEvidenceSnippet: string;
  rawExtractedFields: string[];
  rawCandidateId: string;
}

export interface GeneratedGuide {
  brand: Brand;
  guide: Guide;
}

export interface IngestionPipelineReport {
  fetchedUrl: string;
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
  sourceType: SourceType;
  documentKind?: DocumentKind;
  followedFromUrl?: string;
  hopAttempts?: HopAttempt[];
  discoveredCandidates: CandidateSection[];
  selectedCandidateId?: string;
  rejectedCandidateIds: string[];
  selectionReasoning: string[];
  candidateExtractions: CandidateExtraction[];
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
