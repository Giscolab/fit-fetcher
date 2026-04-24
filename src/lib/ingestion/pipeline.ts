import { discoverCandidateSections } from "@/lib/ingestion/discovery";
import { extractCandidate } from "@/lib/ingestion/extraction";
import { selectCandidate } from "@/lib/ingestion/selection";
import {
  mapRequestedGarmentCategory,
  mapRequestedSizeSystem,
} from "@/lib/ingestion/taxonomy";
import { validateExtraction } from "@/lib/ingestion/validation";
import { buildGeneratedGuide } from "@/lib/normalizers/guideBuilder";
import type {
  GeneratedGuide,
  IngestionPipelineReport,
  ValidationIssue,
  ValidationStatus,
  BrandSource,
} from "@/lib/types";

function deriveInitialIssues(source: BrandSource): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (source.garmentCategory && !mapRequestedGarmentCategory(source.garmentCategory)) {
    issues.push({
      code: "invalid-requested-category",
      message: `Requested garment category "${source.garmentCategory}" is unsupported or ambiguous.`,
      severity: "error",
    });
  }

  if (source.sizeSystem && !mapRequestedSizeSystem(source.sizeSystem)) {
    issues.push({
      code: "invalid-requested-size-system",
      message: `Requested size system "${source.sizeSystem}" is unsupported or ambiguous.`,
      severity: "error",
    });
  }

  return issues;
}

function statusFromIssues(
  issues: ValidationIssue[],
  fallback: ValidationStatus,
): ValidationStatus {
  return issues.some((issue) => issue.severity === "error") ? "rejected" : fallback;
}

export async function runIngestionPipeline(args: {
  source: BrandSource;
  fetchedUrl: string;
  html: string;
  markdown: string;
}): Promise<{
  guide?: GeneratedGuide;
  report: IngestionPipelineReport;
}> {
  const requestedCategory = mapRequestedGarmentCategory(args.source.garmentCategory);
  const requestedSizeSystem = mapRequestedSizeSystem(args.source.sizeSystem);
  const initialIssues = deriveInitialIssues(args.source);
  const initialWarnings: ValidationIssue[] = [];

  const discovered = discoverCandidateSections({
    html: args.html,
    markdown: args.markdown,
    sourceUrl: args.fetchedUrl,
  });

  const selection = selectCandidate({
    requestedCategory,
    requestedSizeSystem,
    candidates: discovered.candidates,
  });

  let report: IngestionPipelineReport = {
    fetchedUrl: args.fetchedUrl,
    requestedCategory,
    requestedSizeSystem,
    sourceType: discovered.sourceType,
    discoveredCandidates: selection.candidates,
    selectedCandidateId: selection.selectedCandidateId,
    rejectedCandidateIds: selection.rejectedCandidateIds,
    selectionReasoning: selection.selectionReasoning,
    candidateExtractions: [],
    validationStatus: statusFromIssues(initialIssues, "warning"),
    validationErrors: initialIssues,
    warnings: initialWarnings,
    manualReviewRecommended: selection.manualReviewRecommended,
  };

  if (!selection.candidates.length) {
    report = {
      ...report,
      validationStatus: "rejected",
      validationErrors: [
        ...report.validationErrors,
        {
          code: "no-candidates-discovered",
          message: "No candidate guide sections were discovered on the page.",
          severity: "error",
        },
      ],
      manualReviewRecommended: true,
    };
    return { report };
  }

  if (!selection.selectedCandidateId || report.validationErrors.length > 0) {
    report = {
      ...report,
      validationStatus: report.validationErrors.length > 0 ? "rejected" : "ambiguous",
      validationErrors: [
        ...report.validationErrors,
        ...(selection.selectedCandidateId
          ? []
          : [
              {
                code: "no-unique-section-match",
                message:
                  "No candidate section matched the requested garment category and size system strongly enough to extract safely.",
                severity: "error" as const,
              },
            ]),
      ],
      manualReviewRecommended: true,
    };
    return { report };
  }

  const selectedCandidate = selection.candidates.find(
    (candidate) => candidate.id === selection.selectedCandidateId,
  );

  if (!selectedCandidate) {
    report = {
      ...report,
      validationStatus: "rejected",
      validationErrors: [
        ...report.validationErrors,
        {
          code: "selected-candidate-missing",
          message: "The selected candidate section could not be resolved.",
          severity: "error",
        },
      ],
      manualReviewRecommended: true,
    };
    return { report };
  }

  const extraction = await extractCandidate({
    sourceUrl: args.fetchedUrl,
    candidate: selectedCandidate,
    requestedCategory,
    requestedSizeSystem,
  });

  const validation = validateExtraction({
    requestedCategory,
    requestedSizeSystem,
    candidate: selectedCandidate,
    extraction,
  });

  const candidateExtraction = {
    ...extraction,
    validationStatus: validation.validationStatus,
    validationErrors: validation.validationErrors,
    warnings: validation.warnings,
  };

  report = {
    ...report,
    candidateExtractions: [candidateExtraction],
    validationStatus: validation.validationStatus,
    validationErrors: [...report.validationErrors, ...validation.validationErrors],
    warnings: validation.warnings,
    manualReviewRecommended:
      report.manualReviewRecommended || validation.validationStatus !== "accepted",
  };

  if (
    validation.validationErrors.length > 0 ||
    !validation.resolvedCategory ||
    !validation.resolvedSizeSystem
  ) {
    return { report };
  }

  const guide = buildGeneratedGuide({
    source: args.source,
    rows: extraction.rows,
    garmentCategory: validation.resolvedCategory,
    sizeSystem: validation.resolvedSizeSystem,
    candidate: selectedCandidate,
    extraction,
    validationStatus: validation.validationStatus,
    validationErrors: validation.validationErrors,
    warnings: validation.warnings,
  });

  return { guide, report };
}
