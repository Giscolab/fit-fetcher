import { discoverCandidateSections } from "@/lib/ingestion/discovery";
import { extractCandidate } from "@/lib/ingestion/extraction";
import { extractCandidateGuideWithLLM } from "@/lib/extractors/llm";
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
  AiFallbackAttempt,
  BrandSource,
  CandidateExtraction,
  CandidateSection,
  GarmentCategory,
  GeneratedGuide,
  IngestionPipelineReport,
  SizeSystem,
  SourceTraceStep,
  ValidationIssue,
  ValidationStatus,
} from "@/lib/types";

type LlmCandidateExtractor = typeof extractCandidateGuideWithLLM;
type ExtractionValidation = ReturnType<typeof validateExtraction>;

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

export interface FetchDocumentOptions {
  renderer?: "auto" | "firecrawl";
  reason?: string;
}

type FetchDocument = (url: string, options?: FetchDocumentOptions) => Promise<{
  sourceUrl: string;
  html: string;
  markdown: string;
}>;

interface ProcessResolvedDocumentArgs {
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
  llmExtractCandidate?: LlmCandidateExtractor;
  renderedRetryAttempted?: boolean;
}

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

function fallbackAttemptIssue(args: {
  originalSource: BrandSource;
  fallbackSource: BrandSource;
  firstReport?: IngestionPipelineReport;
}): ValidationIssue {
  const primary =
    mapRequestedSizeSystem(args.originalSource.sizeSystem) ??
    args.originalSource.sizeSystem ??
    "unspecified";
  const fallback =
    mapRequestedSizeSystem(args.fallbackSource.sizeSystem) ??
    args.fallbackSource.sizeSystem ??
    "unspecified";
  const firstError = args.firstReport?.validationErrors[0]?.message;

  return {
    code: "fallback-size-system-used",
    severity: "warning",
    message: `Primary size system ${primary} did not validate; accepted fallback size system ${fallback}.`,
    details: firstError ? [firstError] : undefined,
  };
}

function fallbackFailureIssue(args: {
  originalSource: BrandSource;
  fallbackSource: BrandSource;
  firstReport?: IngestionPipelineReport;
  fallbackReport?: IngestionPipelineReport;
}): ValidationIssue {
  const primary =
    mapRequestedSizeSystem(args.originalSource.sizeSystem) ??
    args.originalSource.sizeSystem ??
    "unspecified";
  const fallback =
    mapRequestedSizeSystem(args.fallbackSource.sizeSystem) ??
    args.fallbackSource.sizeSystem ??
    "unspecified";
  const details = [
    args.firstReport?.validationErrors[0]?.message,
    args.fallbackReport?.validationErrors[0]?.message,
  ].filter((detail): detail is string => Boolean(detail));

  return {
    code: "fallback-size-system-skipped",
    severity: "warning",
    message: `Primary size system ${primary} failed for size-system reasons; fallback ${fallback} also did not produce a valid guide.`,
    details: details.length ? details : undefined,
  };
}

function sizeSystemFailureText(text: string | undefined): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase();
  const mentionsSizeSystem =
    normalized.includes("size system") ||
    normalized.includes("detected size") ||
    normalized.includes("requested size");
  return (
    normalized.includes("alpha-size") ||
    normalized.includes("international alpha") ||
    (mentionsSizeSystem &&
      (normalized.includes("does not match") ||
        normalized.includes("mismatch") ||
        normalized.includes("not compatible") ||
        normalized.includes("does not expose") ||
        normalized.includes("missing") ||
        normalized.includes("unclear")))
  );
}

function categoryFailureText(text: string | undefined): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return (
    normalized.includes("multiple garment families") ||
    normalized.includes("more than one garment category") ||
    normalized.includes("no single candidate matched the requested category") ||
    normalized.includes("does not match the requested category") ||
    normalized.includes("different garment family") ||
    normalized.includes("not a tops-family") ||
    normalized.includes("not a tops/tshirts") ||
    normalized.includes("generic body guidance")
  );
}

function shouldAttemptFallbackSizeSystem(report: IngestionPipelineReport): boolean {
  const validationTexts = report.validationErrors.flatMap((issue) => [
    issue.code,
    issue.message,
    ...(issue.details ?? []),
  ]);
  const rejectionTexts = report.discoveredCandidates.flatMap(
    (candidate) => candidate.rejectionReasons,
  );
  const allTexts = [
    ...validationTexts,
    ...report.selectionReasoning,
    ...rejectionTexts,
  ];
  const hasSizeSystemFailure = allTexts.some(sizeSystemFailureText);
  const hasCategoryFailure = allTexts.some(categoryFailureText);
  const candidatesRejectedOnlyForSizeSystem =
    report.discoveredCandidates.length > 0 &&
    report.discoveredCandidates.every(
      (candidate) =>
        candidate.rejectionReasons.some(sizeSystemFailureText) &&
        !candidate.rejectionReasons.some(categoryFailureText),
    );

  return (hasSizeSystemFailure || candidatesRejectedOnlyForSizeSystem) && !hasCategoryFailure;
}

function withFallbackDiagnostics(
  result: {
    guide?: GeneratedGuide;
    report: IngestionPipelineReport;
  },
  issue: ValidationIssue,
): {
  guide?: GeneratedGuide;
  report: IngestionPipelineReport;
} {
  return {
    guide: result.guide
      ? {
          ...result.guide,
          guide: {
            ...result.guide.guide,
            warnings: [issue, ...result.guide.guide.warnings],
          },
          shoppingAssistantWarnings: [issue, ...result.guide.shoppingAssistantWarnings],
        }
      : undefined,
    report: {
      ...result.report,
      documentReasoning: [issue.message, ...result.report.documentReasoning],
      warnings: [issue, ...result.report.warnings],
    },
  };
}

function isGuideReady(validation: ExtractionValidation): boolean {
  return (
    validation.validationStatus === "accepted" &&
    validation.validationErrors.length === 0 &&
    validation.warnings.length === 0 &&
    Boolean(validation.resolvedCategory) &&
    Boolean(validation.resolvedSizeSystem)
  );
}

function llmWarningIssue(candidateId: string, message: string): ValidationIssue {
  return {
    code: "llm-warning",
    message,
    severity: "warning",
    candidateId,
  };
}

function llmErrorIssue(candidateId: string, error: unknown): ValidationIssue {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "llm-fallback-error",
    message: `Firecrawl LLM fallback failed: ${message}`,
    severity: "warning",
    candidateId,
  };
}

function reasonForAiAttempt(args: {
  validation: ExtractionValidation;
  rowsCount: number;
}): string {
  if (isGuideReady(args.validation)) {
    return "Firecrawl LLM fallback returned rows that passed strict validation.";
  }

  return (
    args.validation.validationErrors[0]?.message ??
    args.validation.warnings[0]?.message ??
    (args.rowsCount > 0
      ? "Firecrawl LLM fallback returned rows, but strict validation did not accept them."
      : "Firecrawl LLM fallback returned no usable rows.")
  );
}

function isDirectGuideUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return (
    /size-fit\//.test(normalized) ||
    /size-guide\//.test(normalized) ||
    /size-chart/.test(normalized) ||
    /size_charts/.test(normalized) ||
    /pages\/size-guides/.test(normalized)
  );
}

function isRequestedDirectGuideUrl(args: ProcessResolvedDocumentArgs): boolean {
  return (
    args.followDepth === 0 &&
    !args.followedUrl &&
    args.sourceTraceChain.every((step) => step.kind === "requested-url") &&
    isDirectGuideUrl(args.currentUrl)
  );
}

function canRetryWithRenderedDocument(args: ProcessResolvedDocumentArgs): boolean {
  if (!args.fetchDocument || args.renderedRetryAttempted) return false;

  return (
    args.followDepth > 0 ||
    Boolean(args.followedUrl) ||
    args.sourceTraceChain.some((step) => step.kind === "brand-fallback") ||
    isRequestedDirectGuideUrl(args)
  );
}

function renderRefetchIssue(reason: string, error: unknown): ValidationIssue {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "rendered-refetch-failed",
    severity: "error",
    message: `NO_VALID_SIZE_GUIDE: Firecrawl rendering retry failed after static fetch failed. ${reason} ${message}`,
  };
}

async function retryWithRenderedDocument(
  args: ProcessResolvedDocumentArgs,
  report: IngestionPipelineReport,
  reason: string,
): Promise<{
  guide?: GeneratedGuide;
  report: IngestionPipelineReport;
}> {
  const fetchDocument = args.fetchDocument;
  if (!fetchDocument) return { report };

  try {
    const rendered = await fetchDocument(args.currentUrl, {
      renderer: "firecrawl",
      reason,
    });

    return processResolvedDocument({
      ...args,
      currentUrl: rendered.sourceUrl,
      html: rendered.html,
      markdown: rendered.markdown,
      followedUrl: args.followedUrl ? rendered.sourceUrl : args.followedUrl,
      priorReasoning: [...report.documentReasoning, reason],
      renderedRetryAttempted: true,
    });
  } catch (error) {
    return {
      report: appendError(
        {
          ...report,
          documentReasoning: [
            ...report.documentReasoning,
            `${reason} Firecrawl rendering retry failed.`,
          ],
        },
        renderRefetchIssue(reason, error),
      ),
    };
  }
}

async function runAiFallback(args: {
  sourceUrl: string;
  candidate: CandidateSection;
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
  llmExtractCandidate: LlmCandidateExtractor;
}): Promise<{
  extraction?: CandidateExtraction;
  validation?: ExtractionValidation;
  attempt: AiFallbackAttempt;
}> {
  try {
    const llm = await args.llmExtractCandidate({
      url: args.sourceUrl,
      candidate: args.candidate,
      requestedCategory: args.requestedCategory,
      requestedSizeSystem: args.requestedSizeSystem,
    });
    const extraction: CandidateExtraction = {
      candidateId: args.candidate.id,
      strategy: "llm",
      rows: llm.rows,
      extractedFieldKeys: llm.extractedFieldKeys,
      extractionConfidence: llm.score,
      validationStatus: "warning",
      validationErrors: [],
      warnings: llm.warnings.map((warning) =>
        llmWarningIssue(args.candidate.id, warning),
      ),
    };
    const validation = validateExtraction({
      requestedCategory: args.requestedCategory,
      requestedSizeSystem: args.requestedSizeSystem,
      candidate: args.candidate,
      extraction,
    });
    const validatedExtraction: CandidateExtraction = {
      ...extraction,
      validationStatus: validation.validationStatus,
      validationErrors: validation.validationErrors,
      warnings: validation.warnings,
    };

    return {
      extraction: validatedExtraction,
      validation,
      attempt: {
        candidateId: args.candidate.id,
        status: validation.validationStatus,
        reason: reasonForAiAttempt({
          validation,
          rowsCount: llm.rows.length,
        }),
        rowsCount: llm.rows.length,
        extractedFieldKeys: llm.extractedFieldKeys,
        score: llm.score,
        warnings: validation.warnings,
        validationErrors: validation.validationErrors,
      },
    };
  } catch (error) {
    const issue = llmErrorIssue(args.candidate.id, error);
    return {
      attempt: {
        candidateId: args.candidate.id,
        status: "error",
        reason: issue.message,
        rowsCount: 0,
        extractedFieldKeys: [],
        score: 0,
        warnings: [issue],
        validationErrors: [],
      },
    };
  }
}

async function processResolvedDocument(args: ProcessResolvedDocumentArgs): Promise<{
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

    if (
      canRetryWithRenderedDocument(args) &&
      (args.remainingFollowHops <= 0 ||
        !navigation.selected.length ||
        isRequestedDirectGuideUrl(args))
    ) {
      return retryWithRenderedDocument(
        args,
        hubReport,
        "Static followed guide page stayed a hub without an extractable concrete table; retrying the same URL with Firecrawl rendering.",
      );
    }

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
      const isBrandFallback = link.resolver === "brand-fallback";
      const brandFallbackRenderReason =
        "Brand fallback URL requires Firecrawl rendering because JavaScript is required to expose size tables.";
      const followed = await args.fetchDocument(
        link.url,
        isBrandFallback
          ? {
              renderer: "firecrawl",
              reason: brandFallbackRenderReason,
            }
          : undefined,
      );
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
        priorReasoning: [
          ...documentReasoning,
          ...navigation.reasoning,
          ...(isBrandFallback ? [brandFallbackRenderReason] : []),
        ],
        llmExtractCandidate: args.llmExtractCandidate,
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
  const detectedFamilies = distinctDetectedFamilies(selection.candidates);

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

  if (
    canRetryWithRenderedDocument(args) &&
    (classification.documentKind === "irrelevant" ||
      !selection.candidates.length)
  ) {
    return retryWithRenderedDocument(
      args,
      report,
      "Static followed guide page did not expose a single selectable candidate; retrying the same URL with Firecrawl rendering.",
    );
  }

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

  if (detectedFamilies.length > 1) {
    if (selection.selectedCandidateId) {
      // Plusieurs familles détectées, mais un candidat a été sélectionné.
      // On continue avec un warning au lieu de rejeter.
      report.warnings.push({
        code: "multiple-categories-detected",
        message: `Multiple garment families detected (${detectedFamilies.join(", ")}) but a single candidate was selected for the requested category.`,
        severity: "warning",
      });
    } else {
      const bestTopsCandidate = selection.candidates.find(
        (candidate) =>
          candidate.garmentFamily === "tops" && candidate.selectionScore >= 4,
      );

      if (bestTopsCandidate) {
        selection.selectedCandidateId = bestTopsCandidate.id;
        selection.selectionReasoning = [
          ...selection.selectionReasoning,
          `Forced selection of "${bestTopsCandidate.sectionTitle}" (score ${bestTopsCandidate.selectionScore}) as best tops candidate on multi-category page.`,
        ];
        report.selectedCandidateId = bestTopsCandidate.id;
        report.selectionReasoning = selection.selectionReasoning;
        report.manualReviewRecommended = true;
        report.warnings.push({
          code: "multiple-categories-detected",
          message: `Multiple garment families detected (${detectedFamilies.join(", ")}) but the best tops candidate was selected.`,
          severity: "warning",
        });
      } else {
        const familyList = detectedFamilies.join(", ");
        return {
          report: appendError(
            {
              ...report,
              selectionReasoning: [
                ...report.selectionReasoning,
                `Multiple garment families detected (${familyList}) but none matched the requested category.`,
              ],
            },
            {
              code: "multiple-categories-detected",
              message: `NO_VALID_SIZE_GUIDE: more than one garment category was detected (${familyList}) and no single candidate matched the requested category.`,
              severity: "error",
              details: detectedFamilies,
            },
            "ambiguous",
          ),
        };
      }
    }
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

  let finalExtraction = candidateExtraction;
  let finalValidation = validation;

  if (!isGuideReady(validation)) {
    const aiFallback = await runAiFallback({
      sourceUrl: selectedCandidate.sourceUrl,
      candidate: selectedCandidate,
      requestedCategory,
      requestedSizeSystem,
      llmExtractCandidate: args.llmExtractCandidate ?? extractCandidateGuideWithLLM,
    });
    const candidateExtractions = aiFallback.extraction
      ? [candidateExtraction, aiFallback.extraction]
      : [candidateExtraction];
    const aiGuideReady =
      aiFallback.validation != null && isGuideReady(aiFallback.validation);
    const aiReasoning = aiFallback.extraction
      ? aiGuideReady
        ? "Deterministic extraction failed; Firecrawl LLM fallback validated the selected section."
        : "Deterministic extraction failed; Firecrawl LLM fallback also failed strict validation."
      : "Deterministic extraction failed; Firecrawl LLM fallback could not run.";

    if (aiFallback.extraction && aiFallback.validation && aiGuideReady) {
      finalExtraction = aiFallback.extraction;
      finalValidation = aiFallback.validation;
      report = {
        ...report,
        documentReasoning: [...report.documentReasoning, aiReasoning],
        candidateExtractions,
        aiFallbackAttempt: aiFallback.attempt,
        validationStatus: aiFallback.validation.validationStatus,
        validationErrors: aiFallback.validation.validationErrors,
        warnings: aiFallback.validation.warnings,
        manualReviewRecommended: false,
      };
    } else {
      report = {
        ...report,
        documentReasoning: [...report.documentReasoning, aiReasoning],
        candidateExtractions,
        aiFallbackAttempt: aiFallback.attempt,
        validationStatus: aiFallback.validation?.validationStatus ?? report.validationStatus,
        validationErrors: [
          ...report.validationErrors,
          ...(aiFallback.validation?.validationErrors ?? []),
        ],
        warnings: [
          ...report.warnings,
          ...(aiFallback.validation?.warnings ?? aiFallback.attempt.warnings),
        ],
        manualReviewRecommended: true,
      };
      return { report };
    }
  }

  if (!finalValidation.resolvedCategory || !finalValidation.resolvedSizeSystem) {
    return {
      report: appendError(report, {
        code: "resolved-target-missing",
        message:
          "NO_VALID_SIZE_GUIDE: accepted extraction did not resolve a final category or size system.",
        severity: "error",
      }),
    };
  }

  const guide = buildGeneratedGuide({
    source: args.source,
    rows: finalExtraction.rows,
    garmentCategory: finalValidation.resolvedCategory,
    sizeSystem: finalValidation.resolvedSizeSystem,
    candidate: selectedCandidate,
    extraction: finalExtraction,
    validationStatus: finalValidation.validationStatus,
    validationErrors: finalValidation.validationErrors,
    warnings: finalValidation.warnings,
  });

  return { guide, report };
}

export async function runIngestionPipeline(args: {
  source: BrandSource;
  fetchedUrl: string;
  html: string;
  markdown: string;
  fetchDocument?: FetchDocument;
  llmExtractCandidate?: LlmCandidateExtractor;
}): Promise<{
  guide?: GeneratedGuide;
  report: IngestionPipelineReport;
}> {
  const primaryResult = await processResolvedDocument({
    source: args.source,
    originalFetchedUrl: args.fetchedUrl,
    currentUrl: args.fetchedUrl,
    html: args.html,
    markdown: args.markdown,
    fetchDocument: args.fetchDocument,
    sourceTraceChain: [requestedTraceStep(args.source, args.fetchedUrl)],
    remainingFollowHops: 2,
    followDepth: 0,
    llmExtractCandidate: args.llmExtractCandidate,
  });

  if (primaryResult.guide) {
    return primaryResult;
  }

  const primarySizeSystem = mapRequestedSizeSystem(args.source.sizeSystem);
  const fallbackSizeSystem = mapRequestedSizeSystem(args.source.fallbackSizeSystem);

  if (
    !fallbackSizeSystem ||
    fallbackSizeSystem === primarySizeSystem ||
    !shouldAttemptFallbackSizeSystem(primaryResult.report)
  ) {
    return primaryResult;
  }

  const fallbackSource = {
    ...args.source,
    sizeSystem: args.source.fallbackSizeSystem,
  };
  const fallbackResult = await processResolvedDocument({
    source: fallbackSource,
    originalFetchedUrl: args.fetchedUrl,
    currentUrl: args.fetchedUrl,
    html: args.html,
    markdown: args.markdown,
    fetchDocument: args.fetchDocument,
    sourceTraceChain: [requestedTraceStep(fallbackSource, args.fetchedUrl)],
    remainingFollowHops: 2,
    followDepth: 0,
    llmExtractCandidate: args.llmExtractCandidate,
  });

  if (fallbackResult.guide) {
    return withFallbackDiagnostics(
      fallbackResult,
      fallbackAttemptIssue({
        originalSource: args.source,
        fallbackSource,
        firstReport: primaryResult.report,
      }),
    );
  }

  const fallbackIssue = fallbackFailureIssue({
    originalSource: args.source,
    fallbackSource,
    firstReport: primaryResult.report,
    fallbackReport: fallbackResult.report,
  });

  return {
    report: {
      ...primaryResult.report,
      warnings: [...primaryResult.report.warnings, fallbackIssue],
      documentReasoning: [
        ...primaryResult.report.documentReasoning,
        fallbackIssue.message,
      ],
    },
  };
}
