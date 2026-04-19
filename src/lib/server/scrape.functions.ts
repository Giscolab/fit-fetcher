import { createServerFn } from "@tanstack/react-start";
import { scrapeWithFirecrawl } from "@/lib/utils/firecrawl";
import { extractSizeGuide } from "@/lib/extractors/generic";
import { buildGeneratedGuide } from "@/lib/normalizers/guideBuilder";
import type { BrandSource, GeneratedGuide } from "@/lib/types";

export interface ScrapeResponse {
  guide?: GeneratedGuide;
  error?: string;
  logs: string[];
  meta?: { strategy: string; unit: string };
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
    return input;
  })
  .handler(async ({ data }): Promise<ScrapeResponse> => {
    const { source } = data;
    const logs: string[] = [];
    try {
      logs.push(`Fetching ${source.size_guide_url} via Firecrawl…`);
      const scraped = await scrapeWithFirecrawl(source.size_guide_url);
      logs.push(
        `Got ${scraped.html.length} chars HTML, ${scraped.markdown.length} chars markdown`,
      );

      const ext = extractSizeGuide(scraped.html, scraped.markdown);
      logs.push(
        `Extraction strategy=${ext.strategy} unit=${ext.unit} rows=${ext.rows.length} score=${ext.score}`,
      );

      if (!ext.rows.length) {
        return { error: "No size table found on the page", logs };
      }

      const guide = buildGeneratedGuide({ source, rows: ext.rows });
      logs.push(`Built guide ${guide.guide.id} with ${guide.guide.rows.length} rows`);

      return { guide, logs, meta: { strategy: ext.strategy, unit: ext.unit } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logs.push(`ERROR: ${message}`);
      return { error: message, logs };
    }
  });
