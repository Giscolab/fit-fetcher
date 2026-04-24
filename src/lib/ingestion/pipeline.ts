import { discoverCandidateSections } from "@/lib/ingestion/discovery";
import { extractCandidate } from "@/lib/ingestion/extraction";
import {
  buildFollowTraceStep,
  classifyDocument,
  discoverLinkCandidates,
  selectNavigableLink,
} from "@/lib/ingestion/navigation";
import { selectCandidate } from "@/lib/ingestion/selection";
import {
  mapRequestedGarmentCategory,
  mapRequestedSizeSystem,
} from "@/lib/ingestion/taxonomy";
import { validateExtraction } from "@/lib/ingestion/validation";
import { buildGeneratedGuide } from "@/lib/normalizers/guideBuilder";
import type {
  BrandSource,
  GeneratedGuide,
  IngestionPipelineReport,
  SourceTraceStep,
  ValidationIssue,
  ValidationStatus,
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

function requestedTraceStep(source: BrandSource, fetchedUrl: string): SourceTraceStep {
  return {
    kind: "requested-url",
    url: fetchedUrl,
    label: source.name?.trim() || source.brand,
    confidence: 1,
    reasons: ["Initial requested size-guide URL."],
  };
}

export async function runIngestionPipeline(args: {
  source: BrandSource;
  fetchedUrl: string;
  html: string;
  markdown: string;
  fetchDocument?: (url: string) => Promise<{
    sourceUrl: string;
    html: string;
    markdown: string;
  }>;
}): Promise<{
  guide?: GeneratedGuide;
  report: IngestionPipelineReport;
}> {
  const requestedCategory = mapRequestedGarmentCategory(args.source.garmentCategory);
  const requestedSizeSystem = mapRequestedSizeSystem(args.source.sizeSystem);
  const initialIssues = deriveInitialIssues(args.source);
  const initialWarnings: ValidationIssue[] = [];
  const traceChain = [requestedTraceStep(args.source, args.fetchedUrl)];

  const initialLinks = discoverLinkCandidates({
    html: args.html,
    markdown: args.markdown,
    sourceUrl: args.fetchedUrl,
    requestedCategory,
    requestedSizeSystem,
  });
  const initialClassification = classifyDocument({
    html: args.html,
    markdown: args.markdown,
    sourceUrl: args.fetchedUrl,
    linkCandidates: initialLinks,
  });
  let resolvedTraceChain = traceChain;
  let resolvedSourceUrl = args.fetchedUrl;
  let documentKind = initialClassification.documentKind;
  let sourceType = initialClassification.sourceType;
  let documentReasoning = [...initialClassification.reasoning];
  let linkCandidates = initialLinks;
  let navigationConfidence = 0;
  let followedUrl: string | undefined;

  let discoveredCandidates = discoverCandidateSections({
    html: args.html,
    markdown: args.markdown,
    sourceUrl: args.fetchedUrl,
    sourceType,
    documentKind,
    sourceTraceChain: traceChain,
  });
  let selection = selectCandidate({
    requestedCategory,
    requestedSizeSystem,
    candidates: discoveredCandidates,
  });

  const navigation = selectNavigableLink({
    linkCandidates: initialLinks,
    documentKind: initialClassification.documentKind,
  });
  linkCandidates = navigation.linkCandidates;

  const shouldFollow =
    Boolean(args.fetchDocument && navigation.selected) &&
    (
      initialClassification.documentKind === "guide-hub-page" ||
      !selection.selectedCandidateId ||
      !discoveredCandidates.length
    );

  if (shouldFollow && args.fetchDocument && navigation.selected) {
    const followTrace = [...traceChain, buildFollowTraceStep(navigation.selected)];
    resolvedTraceChain = followTrace;
    const followed = await args.fetchDocument(navigation.selected.url);
    resolvedSourceUrl = followed.sourceUrl;
    followedUrl = followed.sourceUrl;
    navigationConfidence = navigation.navigationConfidence;
    documentReasoning = [...documentReasoning, ...navigation.reasoning];

    const followedLinks = discoverLinkCandidates({
      html: followed.html,
      markdown: followed.markdown,
      sourceUrl: followed.sourceUrl,
      requestedCategory,
      requestedSizeSystem,
    });
    const followedClassification = classifyDocument({
      html: followed.html,
      markdown: followed.markdown,
      sourceUrl: followed.sourceUrl,
      linkCandidates: followedLinks,
    });
    documentKind = followedClassification.documentKind;
    sourceType = followedClassification.sourceType;
    documentReasoning = [...documentReasoning, ...followedClassification.reasoning];

    discoveredCandidates = discoverCandidateSections({
      html: followed.html,
      markdown: followed.markdown,
      sourceUrl: followed.sourceUrl,
      sourceType,
      documentKind,
      sourceTraceChain: followTrace,
      linkOriginId: navigation.selected.id,
      navigationConfidence,
    });
    selection = selectCandidate({
      requestedCategory,
      requestedSizeSystem,
      candidates: discoveredCandidates,
    });
  } else {
    documentReasoning = [...documentReasoning, ...navigation.reasoning];
  }

  let report: IngestionPipelineReport = {
    fetchedUrl: args.fetchedUrl,
    resolvedSourceUrl,
    requestedCategory,
    requestedSizeSystem,
    sourceType,
    documentKind,
    documentReasoning,
    sourceTraceChain:
      discoveredCandidates[0]?.sourceTraceChain ?? resolvedTraceChain,
    followedUrl,
    linkCandidates,
    navigationConfidence,
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
    sourceUrl: selectedCandidate.sourceUrl,
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
    resolvedSourceUrl: selectedCandidate.sourceUrl,
    sourceType: selectedCandidate.sourceType,
    discoveredCandidates: selection.candidates,
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
