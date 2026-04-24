import {
  isBottomCategory,
  isTopCategory,
} from "@/lib/ingestion/taxonomy";
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

  if (!requestedCategory) {
    if (
      candidate.detectedCategory !== "unknown" &&
      candidate.detectedCategory !== "tops" &&
      candidate.detectedCategory !== "bottoms"
    ) {
      reasons.push("No requested category was provided, but this section is garment-specific.");
      return { score: 3, reasons, rejections };
    }
    rejections.push("The source request did not specify a precise garment category.");
    return { score: -1, reasons, rejections };
  }

  if (candidate.detectedCategory === requestedCategory) {
    reasons.push("Detected category matches the requested garment category.");
    return { score: 6, reasons, rejections };
  }

  if (
    candidate.detectedCategory === "generic-body-guide" &&
    requestedCategory === "generic-body-guide"
  ) {
    reasons.push("Detected category matches the requested generic body guide.");
    return { score: 5, reasons, rejections };
  }

  if (
    candidate.detectedCategory === "tops" &&
    isTopCategory(requestedCategory)
  ) {
    reasons.push("Section is a broad tops guide, not a garment-specific match.");
    rejections.push("Broad tops sections are ambiguous for a requested specific top category.");
    return { score: 1, reasons, rejections };
  }

  if (
    candidate.detectedCategory === "bottoms" &&
    isBottomCategory(requestedCategory)
  ) {
    reasons.push("Section is a broad bottoms guide, not a garment-specific match.");
    rejections.push("Broad bottoms sections are ambiguous for a requested specific bottom category.");
    return { score: 1, reasons, rejections };
  }

  if (candidate.detectedCategory === "generic-body-guide") {
    rejections.push("Generic body guidance cannot be silently coerced into a garment-specific guide.");
    return { score: -2, reasons, rejections };
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
    return { score: -1, reasons, rejections };
  }

  rejections.push("Detected size system does not match the requested size system.");
  return { score: -3, reasons, rejections };
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
    const score =
      category.score +
      sizeSystem.score +
      (candidate.isTabular ? 2 : -2) +
      candidate.extractionConfidence * 2;
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
      ],
      rejectionReasons: [
        ...candidate.rejectionReasons,
        ...category.rejections,
        ...sizeSystem.rejections,
      ],
      warnings,
    };
  });

  const sorted = [...scored].sort((a, b) => b.selectionScore - a.selectionScore);
  const top = sorted[0];
  const runnerUp = sorted[1];
  const selected =
    top &&
    top.selectionScore >= 6 &&
    top.isTabular &&
    (!runnerUp || top.selectionScore - runnerUp.selectionScore >= 2)
      ? top
      : undefined;

  const selectionReasoning: string[] = [];
  if (selected) {
    selectionReasoning.push(
      `Selected ${selected.sectionTitle} with score ${selected.selectionScore}.`,
    );
    selectionReasoning.push(...selected.matchReasons);
  } else if (top) {
    selectionReasoning.push(
      `No candidate was selected automatically. Best score was ${top.selectionScore} for ${top.sectionTitle}.`,
    );
    if (runnerUp) {
      selectionReasoning.push(
        `The next best candidate ${runnerUp.sectionTitle} scored ${runnerUp.selectionScore}, so the match was not unique enough.`,
      );
    }
    selectionReasoning.push(...top.rejectionReasons.slice(0, 4));
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
