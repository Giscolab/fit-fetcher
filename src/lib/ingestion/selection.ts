import { resolveRequestedCategoryMatch } from "@/lib/ingestion/taxonomy";
import type {
  CandidateSection,
  GarmentCategory,
  IngestionPipelineReport,
  SizeSystem,
} from "@/lib/types";

function roundScore(score: number): number {
  return Math.round(score * 100) / 100;
}

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
    reasons.push("Curated broad-top mapping matched the requested tshirts category.");
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

  if (candidate.detectedSizeSystem === requestedSizeSystem) {
    reasons.push("Detected size system matches the requested size system.");
    return { score: 4, reasons, rejections };
  }

  if (
    candidate.detectedSizeSystem === "NUMERIC" &&
    ["EU", "FR", "IT", "US", "UK"].includes(requestedSizeSystem)
  ) {
    reasons.push("This section is numeric, but the specific numeric size system is not explicit.");
    rejections.push("Numeric sizes without explicit system markers are ambiguous.");
    return { score: 0.5, reasons, rejections };
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
    const category = scoreCategoryMatch(args.requestedCategory, candidate);
    const sizeSystem = scoreSizeSystemMatch(args.requestedSizeSystem, candidate);
    const orientation = orientationBonus(candidate);
    const score =
      category.score +
      sizeSystem.score +
      orientation.score +
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
      ],
      rejectionReasons: [
        ...candidate.rejectionReasons,
        ...category.rejections,
        ...sizeSystem.rejections,
        ...orientation.rejections,
      ],
      warnings,
    };
  });

  const sorted = [...scored].sort((a, b) => b.selectionScore - a.selectionScore);
  const top = sorted[0];
  const runnerUp = sorted[1];
  const selected =
    top &&
    top.selectionScore >= 7 &&
    top.isTabular &&
    top.matrixOrientation !== "conversion-grid" &&
    (!runnerUp || top.selectionScore - runnerUp.selectionScore >= 1.5)
      ? top
      : undefined;

  const selectionReasoning: string[] = [];
  if (selected) {
    selectionReasoning.push(
      `Selected ${selected.sectionTitle} with score ${selected.selectionScore}.`,
    );
    selectionReasoning.push(...selected.matchReasons.slice(0, 6));
  } else if (top) {
    selectionReasoning.push(
      `No candidate was selected automatically. Best score was ${top.selectionScore} for ${top.sectionTitle}.`,
    );
    if (runnerUp) {
      selectionReasoning.push(
        `The next best candidate ${runnerUp.sectionTitle} scored ${runnerUp.selectionScore}, so the match was not unique enough.`,
      );
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
