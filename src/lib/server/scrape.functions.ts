import { createServerFn } from "@tanstack/react-start";
import { scrapeWithFirecrawl } from "@/lib/utils/firecrawl";
import { extractSizeGuide } from "@/lib/extractors/generic";
import { extractSizeGuideLLM } from "@/lib/extractors/llm";
import { buildGeneratedGuide } from "@/lib/normalizers/guideBuilder";
import type { BrandSource, GeneratedGuide } from "@/lib/types";

export interface ScrapeResponse {
  guide?: GeneratedGuide;
  error?: string;
  logs: string[];
  meta?: { strategy: string; unit: string };
}

/**
 * Validate a user-supplied URL before forwarding it to the scraping provider.
 * Rejects non-http(s) protocols and obvious internal/private hostnames to
 * mitigate SSRF-by-proxy abuse.
 */
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
  // Block obvious internal targets. DNS-rebinding and other tricks are still
  // possible, but Firecrawl is the actual fetcher and applies its own checks.
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

/** Server function: scrape a single brand source via Firecrawl + extract guide. */
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
    try {
      logs.push(`Fetching ${source.size_guide_url}…`);
      const scraped = await scrapeWithFirecrawl(source.size_guide_url);
      logs.push(
        `Got ${scraped.html.length} chars HTML, ${scraped.markdown.length} chars markdown`,
      );

      const ext = extractSizeGuide(scraped.html, scraped.markdown);
      logs.push(
        `Extraction strategy=${ext.strategy} unit=${ext.unit} rows=${ext.rows.length} score=${ext.score}`,
      );

      let finalRows = ext.rows;
      let finalStrategy: string = ext.strategy;
      let finalUnit: string = ext.unit;

      if (!finalRows.length) {
        logs.push("Heuristic extraction empty — trying Firecrawl LLM fallback…");
        try {
          const llm = await extractSizeGuideLLM(source.size_guide_url);
          logs.push(
            `LLM extraction unit=${llm.unit} rows=${llm.rows.length} score=${llm.score}`,
          );
          if (llm.rows.length) {
            finalRows = llm.rows;
            finalStrategy = llm.strategy;
            finalUnit = llm.unit;
          }
        } catch (llmErr) {
          const m = llmErr instanceof Error ? llmErr.message : String(llmErr);
          logs.push(`LLM fallback failed: ${m}`);
        }
      }

      if (!finalRows.length) {
        return { error: "No size table found on the page", logs };
      }

      const guide = buildGeneratedGuide({ source, rows: finalRows });
      logs.push(`Built guide ${guide.guide.id} with ${guide.guide.rows.length} rows`);

      return { guide, logs, meta: { strategy: finalStrategy, unit: finalUnit } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logs.push(`ERROR: ${message}`);
      return { error: message, logs };
    }
  });
