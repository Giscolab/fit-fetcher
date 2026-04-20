/**
 * Scrape helper. Server-only — uses FIRECRAWL_API_KEY from env.
 * Returns html + markdown for downstream extraction.
 */

const ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const PLACEHOLDER_API_KEYS = new Set(["fc-YOUR_FIRECRAWL_API_KEY", "fc-5df7edd96b4c49199944b774bcfdc954"]);

export interface ScrapeOutput {
  html: string;
  markdown: string;
  sourceUrl: string;
}

export async function scrapeWithFirecrawl(url: string, attempt = 1): Promise<ScrapeOutput> {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey || PLACEHOLDER_API_KEYS.has(apiKey)) {
    console.error("[scrape] FIRECRAWL_API_KEY is not configured");
    throw new Error("Scraping service is not configured");
  }

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
    // Log full detail server-side only
    console.error(`[scrape] upstream error ${res.status} for ${url}: ${text.slice(0, 500)}`);
    if (res.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500));
      return scrapeWithFirecrawl(url, attempt + 1);
    }
    throw new Error("Scraping failed. Please try again later.");
  }

  const json = (await res.json()) as {
    success?: boolean;
    data?: { html?: string; markdown?: string; metadata?: { sourceURL?: string } };
    html?: string;
    markdown?: string;
    error?: string;
  };

  if (json.success === false) {
    console.error(`[scrape] upstream returned success=false for ${url}: ${json.error ?? "unknown"}`);
    throw new Error("Scraping failed. Please try again later.");
  }

  const html = json.data?.html ?? json.html ?? "";
  const markdown = json.data?.markdown ?? json.markdown ?? "";
  if (!html && !markdown) throw new Error("No content could be retrieved from the page");

  return {
    html,
    markdown,
    sourceUrl: json.data?.metadata?.sourceURL ?? url,
  };
}
