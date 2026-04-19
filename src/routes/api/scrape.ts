import { createFileRoute } from "@tanstack/react-router";
import { scrapeWithFirecrawl } from "@/lib/utils/firecrawl";
import { extractSizeGuide } from "@/lib/extractors/generic";
import { buildGeneratedGuide } from "@/lib/normalizers/guideBuilder";
import type { BrandSource } from "@/lib/types";

export const Route = createFileRoute("/api/scrape")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { source?: BrandSource };
        try {
          body = (await request.json()) as { source?: BrandSource };
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const source = body.source;
        if (!source || !source.brand || !source.size_guide_url) {
          return new Response(
            JSON.stringify({ error: "Missing brand or size_guide_url" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

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
            return new Response(
              JSON.stringify({
                error: "No size table found on the page",
                logs,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          const guide = buildGeneratedGuide({ source, rows: ext.rows });
          logs.push(`Built guide ${guide.guide.id} with ${guide.guide.rows.length} rows`);

          return new Response(
            JSON.stringify({ guide, logs, meta: { strategy: ext.strategy, unit: ext.unit } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logs.push(`ERROR: ${message}`);
          return new Response(JSON.stringify({ error: message, logs }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
