import { createServerFn } from "@tanstack/react-start";
import { runIngestionPipeline } from "@/lib/ingestion/pipeline";
import { normalizeBrandSourceInput } from "@/lib/normalizers/sourceInput";
import { scrapeWithFirecrawl } from "@/lib/utils/firecrawl";
import type {
  BrandSource,
  GeneratedGuide,
  IngestionPipelineReport,
  StrictSizeGuideFailure,
  StrictSizeGuideOutput,
} from "@/lib/types";

export interface ScrapeResponse {
  guide?: GeneratedGuide;
  error?: string;
  reason?: string;
  strictJson?: StrictSizeGuideOutput | StrictSizeGuideFailure;
  logs: string[];
  pipeline: IngestionPipelineReport;
}

function validateExternalUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("size_guide_url must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("size_guide_url must use http or https");
  }
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  if (blocked) {
    throw new Error("size_guide_url points to a disallowed host");
  }
  return parsed;
}

export const scrapeBrandSource = createServerFn({ method: "POST" })
  .inputValidator((input: { source: BrandSource }) => {
    const source = normalizeBrandSourceInput(input?.source);
    if (!source) {
      throw new Error("Invalid source: brand and size_guide_url or entry_url are required");
    }
    if (source.brand.length > 200) {
      throw new Error("brand is too long");
    }
    if (source.size_guide_url.length > 2048) {
      throw new Error("size_guide_url is too long");
    }
    const url = validateExternalUrl(source.size_guide_url);
    return {
      source: { ...source, size_guide_url: url.toString() },
    };
  })
  .handler(async ({ data }): Promise<ScrapeResponse> => {
    const { source } = data;
    const logs: string[] = [];

    try {
      logs.push(`Stage 1/5 fetch: ${source.size_guide_url}`);
      const scraped = await scrapeWithFirecrawl(source.size_guide_url);
      logs.push(
        `Fetched ${scraped.html.length} chars HTML and ${scraped.markdown.length} chars markdown.`,
      );

      logs.push("Stage 2/5 normalize: preparing raw content for candidate discovery.");
      logs.push("Stage 3/5 discovery: segmenting candidate guide sections.");
      const { guide, report } = await runIngestionPipeline({
        source,
        fetchedUrl: scraped.sourceUrl,
        html: scraped.html,
        markdown: scraped.markdown,
        fetchDocument: scrapeWithFirecrawl,
      });

      logs.push(
        `Discovered ${report.discoveredCandidates.length} candidate section(s).`,
      );
      logs.push(`Document kind: ${report.documentKind}.`);
      const followedSteps = report.sourceTraceChain.filter(
        (step) => step.kind === "followed-link" || step.kind === "brand-fallback",
      );
      if (report.followedUrl || followedSteps.length > 0) {
        logs.push(`Followed internal guide chain to ${report.followedUrl ?? followedSteps.at(-1)?.url}.`);
      }
      if (followedSteps.length > 1) {
        logs.push(`Trace: ${followedSteps.map((step) => step.url).join(" -> ")}`);
      }
      if (report.linkCandidates.length > 0) {
        logs.push(`Discovered ${report.linkCandidates.length} internal guide link candidate(s).`);
      }

      if (report.selectedCandidateId) {
        const selected = report.discoveredCandidates.find(
          (candidate) => candidate.id === report.selectedCandidateId,
        );
        logs.push(
          `Selected section ${selected?.sectionTitle ?? report.selectedCandidateId}.`,
        );
        if (selected) {
          logs.push(
            `Selected orientation ${selected.matrixOrientation} with ${selected.rawSizeAxisLabels.length} visible source sizes.`,
          );
        }
        logs.push("Stage 4/5 extraction: extracting only the selected candidate section.");
        logs.push("Stage 5/5 validation: enforcing semantic and traceability checks.");
      } else {
        logs.push("No candidate section was selected automatically.");
      }

      for (const reason of report.selectionReasoning) {
        logs.push(reason);
      }
      for (const issue of report.validationErrors) {
        logs.push(`Validation error: ${issue.message}`);
      }
      for (const warning of report.warnings) {
        logs.push(`Warning: ${warning.message}`);
      }

      if (!guide) {
        const reason =
          report.validationErrors[0]?.message ??
          "The page could not be converted into a validated size guide.";
        return {
          error: "NO_VALID_SIZE_GUIDE",
          reason,
          strictJson: {
            error: "NO_VALID_SIZE_GUIDE",
            reason,
          },
          logs,
          pipeline: report,
        };
      }

      logs.push(
        `Accepted guide ${guide.guide.id} from section ${guide.guide.sourceSectionTitle}.`,
      );

      return {
        guide,
        strictJson: guide.strictGuide,
        logs,
        pipeline: report,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logs.push(`ERROR: ${message}`);
      return {
        error: "NO_VALID_SIZE_GUIDE",
        reason: message,
        strictJson: {
          error: "NO_VALID_SIZE_GUIDE",
          reason: message,
        },
        logs,
        pipeline: {
          fetchedUrl: source.size_guide_url,
          resolvedSourceUrl: source.size_guide_url,
          requestedCategory: null,
          requestedSizeSystem: null,
          sourceType: "category-specific-page",
          documentKind: "irrelevant",
          documentReasoning: [],
          sourceTraceChain: [
            {
              kind: "requested-url",
              url: source.size_guide_url,
              label: source.name?.trim() || source.brand,
              confidence: 1,
              reasons: ["Initial requested size-guide URL."],
            },
          ],
          linkCandidates: [],
          navigationConfidence: 0,
          discoveredCandidates: [],
          rejectedCandidateIds: [],
          selectionReasoning: [],
          candidateExtractions: [],
          validationStatus: "rejected",
          validationErrors: [
            {
              code: "server-error",
              message,
              severity: "error",
            },
          ],
          warnings: [],
          manualReviewRecommended: true,
        },
      };
    }
  });
