/**
 * Firecrawl scrape helper. Server-only — uses FIRECRAWL_API_KEY from env.
 * Returns html + markdown for downstream extraction.
 */

const ENDPOINT = "https://api.firecrawl.dev/v2/scrape";

export interface ScrapeOutput {
  html: string;
  markdown: string;
  sourceUrl: string;
}

export async function scrapeWithFirecrawl(url: string, attempt = 1): Promise<ScrapeOutput> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["html", "markdown"],
      onlyMainContent: false,
      waitFor: 1500,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500));
      return scrapeWithFirecrawl(url, attempt + 1);
    }
    throw new Error(`Firecrawl ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    success?: boolean;
    data?: { html?: string; markdown?: string; metadata?: { sourceURL?: string } };
    html?: string;
    markdown?: string;
    error?: string;
  };

  if (json.success === false) {
    throw new Error(`Firecrawl error: ${json.error ?? "unknown"}`);
  }

  const html = json.data?.html ?? json.html ?? "";
  const markdown = json.data?.markdown ?? json.markdown ?? "";
  if (!html && !markdown) throw new Error("Firecrawl returned no content");

  return {
    html,
    markdown,
    sourceUrl: json.data?.metadata?.sourceURL ?? url,
  };
}
