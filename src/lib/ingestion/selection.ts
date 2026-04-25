import { fieldFromHeader } from "@/lib/ingestion/measurements";
import {
  containsAny,
  normalizeToken,
  resolveRequestedCategoryMatch,
} from "@/lib/ingestion/taxonomy";
import type {
  CandidateSection,
  GarmentCategory,
  IngestionPipelineReport,
  MeasurementField,
  SizeSystem,
} from "@/lib/types";

function roundScore(score: number): number {
  return Math.round(score * 100) / 100;
}

const MIN_SELECTION_SCORE = 4;
const MIN_GAP_BETWEEN_TOP_CANDIDATES = 0;

// Systèmes de tailles acceptables quand on demande INT
const ACCEPTABLE_SIZE_SYSTEMS_FOR_INT: ReadonlySet<string> = new Set([
  "INT",
  "US",
  "EU",
  "UK",
  "FR",
  "IT",
  "NUMERIC",
]);

// Catégories acceptables quand on demande tshirts
const ACCEPTABLE_CATEGORIES_FOR_TSHIRTS: ReadonlySet<string> = new Set([
  "tshirts",
  "tops",
  "shirts",
  "hoodies",
  "jackets",
]);

function scoreCategoryMatch(
  requestedCategory: GarmentCategory | null,
  candidate: CandidateSection,
): { score: number; reasons: string[]; rejections: string[] } {
  const reasons: string[] = [];
  const rejections: string[] = [];
  const match = resolveRequestedCategoryMatch({
    requestedCategory,
    detectedCategory: candidate.detectedCategory,
    categoryMappingMode: candidate.categoryMappingMode,
  });

  if (!requestedCategory) {
    if (match.matchedCategory) {
      reasons.push("No requested category was provided, but this section is category-resolved.");
      return { score: 3, reasons, rejections };
    }
    rejections.push("The source request did not specify a precise garment category.");
    return { score: -1, reasons, rejections };
  }

  if (match.mode === "exact") {
    reasons.push("Detected category matches the requested garment category.");
    return { score: 6, reasons, rejections };
  }

  if (match.mode === "curated") {
    reasons.push("Top-family evidence matched the requested guide category.");
    if (candidate.categoryMappingReason) {
      reasons.push(candidate.categoryMappingReason);
    }
    return { score: 4.5, reasons, rejections };
  }

  if (match.mode === "generic-body") {
    reasons.push("Detected category matches the requested generic body guide.");
    return { score: 5, reasons, rejections };
  }

  if (candidate.detectedCategory === "generic-body-guide") {
    rejections.push("Generic body guidance cannot be silently coerced into a garment-specific guide.");
    return { score: -3, reasons, rejections };
  }

  if (candidate.detectedCategory === "tops" || candidate.detectedCategory === "bottoms") {
    rejections.push("Broad garment-family evidence was not specific enough for this request.");
    return { score: 0.5, reasons, rejections };
  }

  rejections.push("Detected category does not match the requested garment category.");
  return { score: -4, reasons, rejections };
}

function scoreSizeSystemMatch(
  requestedSizeSystem: SizeSystem | null,
  candidate: CandidateSection,
): { score: number; reasons: string[]; rejections: string[] } {
  const reasons: string[] = [];
  const rejections: string[] = [];

  if (!requestedSizeSystem) {
    if (
      candidate.detectedSizeSystem !== "UNKNOWN" &&
      candidate.detectedSizeSystem !== "NUMERIC"
    ) {
      reasons.push("No requested size system was provided, but this section has a detectable size system.");
      return { score: 2, reasons, rejections };
    }
    rejections.push("The source request did not specify a precise size system.");
    return { score: 0, reasons, rejections };
  }

  // Correspondance exacte : bonus maximal
  if (candidate.detectedSizeSystem === requestedSizeSystem) {
    reasons.push("Detected size system matches the requested size system.");
    return { score: 4, reasons, rejections };
  }

  // Pour INT, accepter les systèmes numériques convertibles
  if (requestedSizeSystem === "INT" && ACCEPTABLE_SIZE_SYSTEMS_FOR_INT.has(candidate.detectedSizeSystem)) {
    if (candidate.detectedSizeSystem === "UNKNOWN") {
      rejections.push("The section does not expose a clear size system.");
      return { score: -0.5, reasons, rejections };
    }
    reasons.push(`Detected ${candidate.detectedSizeSystem} size system is convertible and compatible with requested INT.`);
    return { score: 2.5, reasons, rejections };
  }

  // Si on demande un système numérique spécifique, accepter NUMERIC générique
  if (
    candidate.detectedSizeSystem === "NUMERIC" &&
    requestedSizeSystem !== "INT" &&
    requestedSizeSystem !== "WAIST_INSEAM" &&
    requestedSizeSystem !== "FOOTWEAR" &&
    requestedSizeSystem !== "SOCK" &&
    requestedSizeSystem !== "BRA"
  ) {
    reasons.push("Detected numeric size system may match the requested system after extraction.");
    return { score: 1.5, reasons, rejections };
  }

  if (candidate.detectedSizeSystem === "UNKNOWN") {
    rejections.push("The section does not expose a clear size system.");
    return { score: -0.5, reasons, rejections };
  }

  rejections.push("Detected size system does not match the requested size system.");
  return { score: -3, reasons, rejections };
}

function orientationBonus(candidate: CandidateSection): {
  score: number;
  reasons: string[];
  rejections: string[];
} {
  if (candidate.matrixOrientation === "size-rows") {
    return {
      score: 1.5,
      reasons: ["The section exposes size rows directly."],
      rejections: [],
    };
  }

  if (candidate.matrixOrientation === "size-columns") {
    return {
      score: 1.5,
      reasons: ["The section exposes transposed size columns that can be extracted safely."],
      rejections: [],
    };
  }

  if (candidate.matrixOrientation === "conversion-grid") {
    return {
      score: -1,
      reasons: [],
      rejections: ["Conversion grids are lower-confidence sources for garment measurements."],
    };
  }

  return {
    score: -1,
    reasons: [],
    rejections: ["Matrix orientation could not be resolved confidently."],
  };
}

function unitPreferenceBonus(candidate: CandidateSection): {
  score: number;
  reasons: string[];
  rejections: string[];
} {
  if (candidate.originalUnitSystem === "cm") {
    return {
      score: 1.2,
      reasons: ["Centimeter measurements can be extracted without unit conversion."],
      rejections: [],
    };
  }

  if (candidate.originalUnitSystem === "in") {
    return {
      score: 0.4,
      reasons: ["Inch measurements can be converted to centimeters deterministically."],
      rejections: [],
    };
  }

  if (candidate.originalUnitSystem === "mixed") {
    return {
      score: -3,
      reasons: [],
      rejections: ["Candidate mixes cm and inches in the same table."],
    };
  }

  return {
    score: 0,
    reasons: [],
    rejections: [],
  };
}

function candidateMeasurementFields(candidate: CandidateSection): MeasurementField[] {
  const fields = new Set<MeasurementField>();
  for (const label of [
    ...candidate.rawHeaders,
    ...candidate.rawStubColumn,
    ...candidate.visibleColumnLabels,
    ...candidate.visibleRowLabels,
    ...candidate.matrix.flat(),
  ]) {
    const field = fieldFromHeader(label);
    if (field) fields.add(field);
  }
  return Array.from(fields);
}

function sameMeasurementShape(left: CandidateSection, right: CandidateSection): boolean {
  const leftFields = candidateMeasurementFields(left).sort().join("|");
  const rightFields = candidateMeasurementFields(right).sort().join("|");
  const leftSizes = left.rawSizeAxisLabels.map((label) => normalizeToken(label)).join("|");
  const rightSizes = right.rawSizeAxisLabels.map((label) => normalizeToken(label)).join("|");

  return (
    left.detectedCategory === right.detectedCategory &&
    left.garmentFamily === right.garmentFamily &&
    left.matrixOrientation === right.matrixOrientation &&
    leftFields === rightFields &&
    leftSizes === rightSizes &&
    left.originalUnitSystem !== right.originalUnitSystem &&
    [left.originalUnitSystem, right.originalUnitSystem].every((unit) =>
      unit === "cm" || unit === "in",
    )
  );
}

function strictCandidateRejections(args: {
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
  candidate: CandidateSection;
}): string[] {
  const { candidate } = args;
  const rejections: string[] = [];
  const fields = candidateMeasurementFields(candidate);
  const text = normalizeToken(
    [
      candidate.sectionTitle,
      candidate.subheading ?? "",
      candidate.headingPath.join(" "),
      candidate.nearbyAdvisoryText,
      candidate.rawHeaders.join(" "),
      candidate.rawStubColumn.join(" "),
      candidate.matrix.flat().join(" "),
    ].join(" "),
  );
  const categoryMatch = resolveRequestedCategoryMatch({
    requestedCategory: args.requestedCategory,
    detectedCategory: candidate.detectedCategory,
    categoryMappingMode: candidate.categoryMappingMode,
  });

  // ── Rejets absolus (indépendants de la requête) ──────────────────────

  if (candidate.documentKind === "guide-hub-page") {
    rejections.push("Guide hub pages cannot be extracted directly.");
  }

  if (!candidate.isTabular) {
    rejections.push("Candidate is not a structured table or grid.");
  }

  if (candidate.rawSizeAxisLabels.length < 2) {
    rejections.push("Candidate does not expose at least two visible size labels.");
  }

  if (fields.length < 2) {
    rejections.push("Candidate does not expose at least two measurement fields.");
  }

  if (candidate.originalUnitSystem === "mixed") {
    rejections.push("Candidate mixes cm and inches in the same table.");
  }

  if (
    candidate.matrixOrientation === "unknown" ||
    candidate.matrixOrientation === "conversion-grid"
  ) {
    rejections.push("Candidate matrix orientation is ambiguous or a conversion grid.");
  }

  // ── Rejets conditionnels (dépendants de la requête) ──────────────────

  // Size system : ne rejeter que si vraiment incompatible
  if (args.requestedSizeSystem === "INT") {
    if (!ACCEPTABLE_SIZE_SYSTEMS_FOR_INT.has(candidate.detectedSizeSystem)) {
      rejections.push(
        `Candidate size system "${candidate.detectedSizeSystem}" is not compatible with requested INT.`,
      );
    }
  } else if (args.requestedSizeSystem) {
    if (
      candidate.detectedSizeSystem !== args.requestedSizeSystem &&
      candidate.detectedSizeSystem !== "UNKNOWN" &&
      candidate.detectedSizeSystem !== "NUMERIC"
    ) {
      rejections.push(
        `Candidate size system "${candidate.detectedSizeSystem}" does not match requested "${args.requestedSizeSystem}".`,
      );
    }
  }

  // Catégorie : accepter la famille tops au sens large
  if (args.requestedCategory === "tshirts") {
    if (
      categoryMatch.mode === "none" ||
      !ACCEPTABLE_CATEGORIES_FOR_TSHIRTS.has(candidate.detectedCategory)
    ) {
      rejections.push(
        `Candidate category "${candidate.detectedCategory}" is not a tops-family guide.`,
      );
    }
    if (!fields.includes("chest") && !fields.includes("height")) {
      rejections.push("Candidate lacks a chest, bust, or torso measurement.");
    }
    if (fields.includes("inseam") || containsAny(text, ["inseam", "inside leg", "entrejambe"])) {
      rejections.push("Candidate contains inseam evidence, which belongs to bottoms.");
    }
    if (
      fields.includes("footLength") ||
      fields.includes("footWidth") ||
      containsAny(text, ["shoe size", "footwear", "foot length", "chaussure"])
    ) {
      rejections.push("Candidate contains shoe or footwear evidence.");
    }
  }

  return rejections;
}

export function selectCandidate(args: {
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
  candidates: CandidateSection[];
}): {
  candidates: CandidateSection[];
  selectedCandidateId?: string;
  rejectedCandidateIds: string[];
  selectionReasoning: string[];
  manualReviewRecommended: boolean;
} {
  const scored = args.candidates.map((candidate) => {
    const strictRejections = strictCandidateRejections({
      requestedCategory: args.requestedCategory,
      requestedSizeSystem: args.requestedSizeSystem,
      candidate,
    });
    const category = scoreCategoryMatch(args.requestedCategory, candidate);
    const sizeSystem = scoreSizeSystemMatch(args.requestedSizeSystem, candidate);
    const orientation = orientationBonus(candidate);
    const unit = unitPreferenceBonus(candidate);
    const score =
      strictRejections.length > 0
        ? -20 - strictRejections.length
        : category.score +
          sizeSystem.score +
          orientation.score +
          unit.score +
          (candidate.isTabular ? 2 : -2) +
          Math.min(candidate.rawSizeAxisLabels.length, 10) * 0.15 +
          candidate.extractionConfidence * 2 +
          Math.min(0.5, candidate.navigationConfidence);
    const warnings = [...candidate.warnings];

    if (candidate.kind === "advisory-text") {
      warnings.push("This section is advisory text and cannot be used as a table-backed guide.");
    }

    return {
      ...candidate,
      selectionScore: roundScore(score),
      matchReasons: [
        ...candidate.matchReasons,
        ...category.reasons,
        ...sizeSystem.reasons,
        ...orientation.reasons,
        ...unit.reasons,
      ],
      rejectionReasons: [
        ...strictRejections,
        ...candidate.rejectionReasons,
        ...category.rejections,
        ...sizeSystem.rejections,
        ...orientation.rejections,
        ...unit.rejections,
      ],
      warnings,
    };
  });

  const sorted = [...scored].sort((a, b) => b.selectionScore - a.selectionScore);
  const top = sorted[0];
  const runnerUp = sorted[1];
  const runnerUpIsUnitDuplicate =
    Boolean(top && runnerUp && sameMeasurementShape(top, runnerUp));
  const selected =
    top &&
    top.selectionScore >= MIN_SELECTION_SCORE &&
    top.isTabular &&
    top.matrixOrientation !== "conversion-grid" &&
    (!runnerUp ||
      top.selectionScore - runnerUp.selectionScore >= MIN_GAP_BETWEEN_TOP_CANDIDATES ||
      runnerUpIsUnitDuplicate)
      ? top
      : undefined;

  const selectionReasoning: string[] = [];
  if (selected) {
    selectionReasoning.push(
      `Selected ${selected.sectionTitle} with score ${selected.selectionScore}.`,
    );
    if (runnerUpIsUnitDuplicate && runnerUp) {
      selectionReasoning.push(
        `Ignored ${runnerUp.sectionTitle} as a duplicate measurement table in another unit.`,
      );
    }
    selectionReasoning.push(...selected.matchReasons.slice(0, 6));
  } else if (top) {
    selectionReasoning.push(
      `No candidate was selected automatically. Best score was ${top.selectionScore} for ${top.sectionTitle}.`,
    );
    if (runnerUp) {
      if (runnerUpIsUnitDuplicate) {
        selectionReasoning.push(
          `The next best candidate ${runnerUp.sectionTitle} scored ${runnerUp.selectionScore}, but it has the same measurement shape in another unit.`,
        );
      } else {
        selectionReasoning.push(
          `The next best candidate ${runnerUp.sectionTitle} scored ${runnerUp.selectionScore}, so the match was not unique enough under strict validation.`,
        );
      }
    }
    selectionReasoning.push(...top.rejectionReasons.slice(0, 5));
  } else {
    selectionReasoning.push("No candidate sections were discovered on the page.");
  }

  return {
    candidates: scored,
    selectedCandidateId: selected?.id,
    rejectedCandidateIds: scored
      .filter((candidate) => candidate.id !== selected?.id)
      .map((candidate) => candidate.id),
    selectionReasoning,
    manualReviewRecommended: !selected,
  };
}

export function patchReportSelection(
  report: IngestionPipelineReport,
  updates: ReturnType<typeof selectCandidate>,
): IngestionPipelineReport {
  return {
    ...report,
    discoveredCandidates: updates.candidates,
    selectedCandidateId: updates.selectedCandidateId,
    rejectedCandidateIds: updates.rejectedCandidateIds,
    selectionReasoning: updates.selectionReasoning,
    manualReviewRecommended: updates.manualReviewRecommended,
  };
}