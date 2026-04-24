import { discoverCandidateSections } from "@/lib/ingestion/discovery";
import { extractCandidate } from "@/lib/ingestion/extraction";
import {
  buildFollowTraceStep,
  classifyDocument,
  discoverLinkCandidates,
  selectHubFollowLinks,
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

type FetchDocument = (url: string) => Promise<{
  sourceUrl: string;
  html: string;
  markdown: string;
}>;

function appendError(
  report: IngestionPipelineReport,
  issue: ValidationIssue,
  validationStatus: ValidationStatus = "rejected",
): IngestionPipelineReport {
  return {
    ...report,
    validationStatus,
    validationErrors: [...report.validationErrors, issue],
    manualReviewRecommended: true,
  };
}

function distinctDetectedFamilies(candidates: IngestionPipelineReport["discoveredCandidates"]): string[] {
  return Array.from(
    new Set(
      candidates
        .filter((candidate) => candidate.isTabular && candidate.garmentFamily !== "unknown")
        .map((candidate) => candidate.garmentFamily),
    ),
  );
}

function guideSourceKey(result: {
  guide?: GeneratedGuide;
  report: IngestionPipelineReport;
}): string {
  return result.guide?.strictGuide.source_url ?? result.report.resolvedSourceUrl;
}

function uniqueAcceptedResults(
  results: Array<{
    guide?: GeneratedGuide;
    report: IngestionPipelineReport;
  }>,
): Array<{
  guide?: GeneratedGuide;
  report: IngestionPipelineReport;
}> {
  const accepted = results.filter(
    (result) => result.guide && result.report.validationStatus === "accepted",
  );
  const bySource = new Map<string, (typeof accepted)[number]>();

  for (const result of accepted) {
    bySource.set(guideSourceKey(result), result);
  }

  return Array.from(bySource.values());
}

async function processResolvedDocument(args: {
  source: BrandSource;
  originalFetchedUrl: string;
  currentUrl: string;
  html: string;
  markdown: string;
  fetchDocument?: FetchDocument;
  sourceTraceChain: SourceTraceStep[];
  followedUrl?: string;
  linkOriginId?: string;
  navigationConfidence?: number;
  remainingFollowHops: number;
  followDepth: number;
  priorReasoning?: string[];
}): Promise<{
  guide?: GeneratedGuide;
  report: IngestionPipelineReport;
}> {
  const requestedCategory = mapRequestedGarmentCategory(args.source.garmentCategory);
  const requestedSizeSystem = mapRequestedSizeSystem(args.source.sizeSystem);
  const initialIssues = deriveInitialIssues(args.source);
  const initialWarnings: ValidationIssue[] = [];
  const linkCandidates = discoverLinkCandidates({
    html: args.html,
    markdown: args.markdown,
    sourceUrl: args.currentUrl,
    requestedCategory,
    requestedSizeSystem,
  });
  const classification = classifyDocument({
    html: args.html,
    markdown: args.markdown,
    sourceUrl: args.currentUrl,
    linkCandidates,
  });
  const documentReasoning = [
    ...(args.priorReasoning ?? []),
    ...classification.reasoning,
  ];

  if (classification.documentKind === "guide-hub-page") {
    const navigation = selectHubFollowLinks({
      linkCandidates,
      requireConcreteGuide: args.followDepth >= 1,
    });
    const hubReport: IngestionPipelineReport = {
      fetchedUrl: args.originalFetchedUrl,
      resolvedSourceUrl: args.currentUrl,
      requestedCategory,
      requestedSizeSystem,
      sourceType: classification.sourceType,
      documentKind: classification.documentKind,
      documentReasoning: [...documentReasoning, ...navigation.reasoning],
      sourceTraceChain: args.sourceTraceChain,
      followedUrl: args.followedUrl,
      linkCandidates: navigation.linkCandidates,
      navigationConfidence: navigation.navigationConfidence,
      discoveredCandidates: [],
      rejectedCandidateIds: [],
      selectionReasoning: navigation.reasoning,
      candidateExtractions: [],
      validationStatus: statusFromIssues(initialIssues, "rejected"),
      validationErrors: initialIssues,
      warnings: initialWarnings,
      manualReviewRecommended: true,
    };

    if (args.remainingFollowHops <= 0 || !args.fetchDocument) {
      return {
        report: appendError(hubReport, {
          code: "unresolved-guide-hub",
          message:
            "NO_VALID_SIZE_GUIDE: guide hub pages must resolve to one concrete guide page within two controlled internal hops.",
          severity: "error",
        }),
      };
    }

    if (!navigation.selected.length) {
      return {
        report: appendError(hubReport, {
          code: "no-followable-guide-link",
          message:
            args.followDepth >= 1
              ? "NO_VALID_SIZE_GUIDE: no second-hop concrete size-guide link scored high enough."
              : "NO_VALID_SIZE_GUIDE: no same-domain internal guide link scored high enough for a one-hop follow.",
          severity: "error",
        }),
      };
    }

    const followedResults: Array<{
      guide?: GeneratedGuide;
      report: IngestionPipelineReport;
    }> = [];

    for (const link of navigation.selected) {
      const followed = await args.fetchDocument(link.url);
      const child = await processResolvedDocument({
        source: args.source,
        originalFetchedUrl: args.originalFetchedUrl,
        currentUrl: followed.sourceUrl,
        html: followed.html,
        markdown: followed.markdown,
        fetchDocument: args.fetchDocument,
        sourceTraceChain: [...args.sourceTraceChain, buildFollowTraceStep(link)],
        followedUrl: followed.sourceUrl,
        linkOriginId: link.id,
        navigationConfidence: Math.min(0.98, 0.35 + link.score / 10),
        remainingFollowHops: args.remainingFollowHops - 1,
        followDepth: args.followDepth + 1,
        priorReasoning: [...documentReasoning, ...navigation.reasoning],
      });

      followedResults.push({
        guide: child.guide,
        report: {
          ...child.report,
          fetchedUrl: args.originalFetchedUrl,
          followedUrl: child.report.followedUrl ?? followed.sourceUrl,
          linkCandidates: navigation.linkCandidates,
          navigationConfidence: Math.min(0.98, 0.35 + link.score / 10),
          documentReasoning: child.report.documentReasoning,
        },
      });
    }

    const accepted = uniqueAcceptedResults(followedResults);

    if (accepted.length === 1) {
      return accepted[0]!;
    }

    const details = followedResults.flatMap((result) =>
      result.report.validationErrors.map((issue) => issue.message),
    );
    return {
      report: appendError(
        {
          ...hubReport,
          validationErrors: [...hubReport.validationErrors],
          warnings: followedResults.flatMap((result) => result.report.warnings),
        },
        {
          code: accepted.length > 1 ? "ambiguous-followed-guides" : "no-valid-followed-guide",
          message:
            accepted.length > 1
              ? "NO_VALID_SIZE_GUIDE: multiple followed internal guide pages validated, so the source is ambiguous."
              : "NO_VALID_SIZE_GUIDE: no followed internal guide page validated as a single tops/tshirts / INT table.",
          severity: "error",
          details: details.slice(0, 8),
        },
        accepted.length > 1 ? "ambiguous" : "rejected",
      ),
    };
  }

  const discoveredCandidates = discoverCandidateSections({
    html: args.html,
    markdown: args.markdown,
    sourceUrl: args.currentUrl,
    sourceType: classification.sourceType,
    documentKind: classification.documentKind,
    sourceTraceChain: args.sourceTraceChain,
    linkOriginId: args.linkOriginId,
    navigationConfidence: args.navigationConfidence ?? 0,
  });
  const selection = selectCandidate({
    requestedCategory,
    requestedSizeSystem,
    candidates: discoveredCandidates,
  });

  let report: IngestionPipelineReport = {
    fetchedUrl: args.originalFetchedUrl,
    resolvedSourceUrl: args.currentUrl,
    requestedCategory,
    requestedSizeSystem,
    sourceType: classification.sourceType,
    documentKind: classification.documentKind,
    documentReasoning,
    sourceTraceChain: discoveredCandidates[0]?.sourceTraceChain ?? args.sourceTraceChain,
    followedUrl: args.followedUrl,
    linkCandidates,
    navigationConfidence: args.navigationConfidence ?? 0,
    discoveredCandidates: selection.candidates,
    selectedCandidateId: selection.selectedCandidateId,
    rejectedCandidateIds: selection.rejectedCandidateIds,
    selectionReasoning: selection.selectionReasoning,
    candidateExtractions: [],
    validationStatus: statusFromIssues(initialIssues, "rejected"),
    validationErrors: initialIssues,
    warnings: initialWarnings,
    manualReviewRecommended: selection.manualReviewRecommended,
  };

  if (classification.documentKind === "irrelevant") {
    return {
      report: appendError(report, {
        code: "irrelevant-document",
        message: "NO_VALID_SIZE_GUIDE: fetched document is not a usable size guide.",
        severity: "error",
      }),
    };
  }

  if (!selection.candidates.length) {
    return {
      report: appendError(report, {
        code: "no-candidates-discovered",
        message: "NO_VALID_SIZE_GUIDE: no structured candidate size table was discovered.",
        severity: "error",
      }),
    };
  }

  const detectedFamilies = distinctDetectedFamilies(selection.candidates);
  if (detectedFamilies.length > 1) {
    return {
      report: appendError(
        report,
        {
          code: "multiple-categories-detected",
          message:
            "NO_VALID_SIZE_GUIDE: more than one garment category was detected on the resolved page.",
          severity: "error",
          details: detectedFamilies,
        },
        "ambiguous",
      ),
    };
  }

  if (!selection.selectedCandidateId || report.validationErrors.length > 0) {
    return {
      report: appendError(
        report,
        {
          code: selection.selectedCandidateId
            ? "invalid-request"
            : "no-unique-section-match",
          message: selection.selectedCandidateId
            ? "NO_VALID_SIZE_GUIDE: source request is invalid for strict extraction."
            : "NO_VALID_SIZE_GUIDE: no single candidate matched tops/tshirts / INT strongly enough.",
          severity: "error",
        },
        selection.selectedCandidateId ? "rejected" : "ambiguous",
      ),
    };
  }

  const selectedCandidate = selection.candidates.find(
    (candidate) => candidate.id === selection.selectedCandidateId,
  );

  if (!selectedCandidate) {
    return {
      report: appendError(report, {
        code: "selected-candidate-missing",
        message: "NO_VALID_SIZE_GUIDE: selected candidate section could not be resolved.",
        severity: "error",
      }),
    };
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
    manualReviewRecommended: validation.validationStatus !== "accepted",
  };

  if (
    validation.validationStatus !== "accepted" ||
    validation.validationErrors.length > 0 ||
    validation.warnings.length > 0 ||
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

export async function runIngestionPipeline(args: {
  source: BrandSource;
  fetchedUrl: string;
  html: string;
  markdown: string;
  fetchDocument?: FetchDocument;
}): Promise<{
  guide?: GeneratedGuide;
  report: IngestionPipelineReport;
}> {
  return processResolvedDocument({
    source: args.source,
    originalFetchedUrl: args.fetchedUrl,
    currentUrl: args.fetchedUrl,
    html: args.html,
    markdown: args.markdown,
    fetchDocument: args.fetchDocument,
    sourceTraceChain: [requestedTraceStep(args.source, args.fetchedUrl)],
    remainingFollowHops: 2,
    followDepth: 0,
  });
}
