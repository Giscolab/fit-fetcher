import { createServerFn } from "@tanstack/react-start";
import { resolveSizeGuide } from "@/lib/ingestion/hubResolver";
import type {
  BrandSource,
  GeneratedGuide,
  IngestionPipelineReport,
} from "@/lib/types";

export interface ScrapeResponse {
  guide?: GeneratedGuide;
  error?: string;
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
    if (
      !input ||
      !input.source ||
      typeof input.source.brand !== "string" ||
      typeof input.source.size_guide_url !== "string"
    ) {
      throw new Error("Invalid source: brand and size_guide_url are required");
    }
    if (input.source.brand.length > 200) {
      throw new Error("brand is too long");
    }
    if (input.source.size_guide_url.length > 2048) {
      throw new Error("size_guide_url is too long");
    }
    const url = validateExternalUrl(input.source.size_guide_url);
    return {
      source: { ...input.source, size_guide_url: url.toString() },
    };
  })
  .handler(async ({ data }): Promise<ScrapeResponse> => {
    const { source } = data;
    const logs: string[] = [];
    const pushLog = (line: string) => logs.push(line);

    try {
      pushLog(`Stage 0/7 fetch + classify: ${source.size_guide_url}`);

      const { guide, report } = await resolveSizeGuide({
        source,
        initialUrl: source.size_guide_url,
        log: pushLog,
      });

      pushLog(
        `Stage 2/7 discovery: ${report.discoveredCandidates.length} candidate section(s) on resolved page.`,
      );

      if (report.selectedCandidateId) {
        const selected = report.discoveredCandidates.find(
          (candidate) => candidate.id === report.selectedCandidateId,
        );
        pushLog(
          `Stage 3/7 selection: ${selected?.sectionTitle ?? report.selectedCandidateId}`,
        );
        pushLog("Stage 4/7 extraction: extracting only the selected candidate section.");
        pushLog("Stage 5/7 validation: enforcing semantic and traceability checks.");
      } else {
        pushLog("Stage 3/7 selection: no candidate section was selected automatically.");
      }

      for (const reason of report.selectionReasoning) pushLog(reason);
      for (const issue of report.validationErrors) {
        pushLog(`Validation error: ${issue.message}`);
      }
      for (const warning of report.warnings) {
        pushLog(`Warning: ${warning.message}`);
      }

      if (report.hopAttempts && report.hopAttempts.length > 1) {
        pushLog(
          `Stage 1/7 follow trace: ${report.hopAttempts.length} document(s) inspected (1-hop max).`,
        );
        for (const attempt of report.hopAttempts) {
          pushLog(
            `   • ${attempt.documentKind} ${attempt.outcome} (${attempt.candidatesDiscovered} candidate(s)) ${attempt.url}`,
          );
        }
      }

      if (!guide) {
        return {
          error:
            report.validationErrors[0]?.message ??
            "The page could not be converted into a validated size guide.",
          logs,
          pipeline: report,
        };
      }

      pushLog(
        `Stage 7/7 emit: accepted guide ${guide.guide.id} from section ${guide.guide.sourceSectionTitle}.`,
      );

      return {
        guide,
        logs,
        pipeline: report,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushLog(`ERROR: ${message}`);
      return {
        error: message,
        logs,
        pipeline: {
          fetchedUrl: source.size_guide_url,
          requestedCategory: null,
          requestedSizeSystem: null,
          sourceType: "category-specific-page",
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
