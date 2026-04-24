/**
 * Firecrawl helpers. Server-only — uses FIRECRAWL_API_KEY from env.
 */

const ENDPOINT = "https://api.firecrawl.dev/v2/scrape";

export interface ScrapeOutput {
  html: string;
  markdown: string;
  sourceUrl: string;
}

function getApiKey(): string {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey || apiKey === "fc-YOUR_FIRECRAWL_API_KEY") {
    console.error("[scrape] FIRECRAWL_API_KEY is not configured");
    throw new Error("Scraping service is not configured");
  }
  return apiKey;
}

export async function scrapeWithFirecrawl(url: string, attempt = 1): Promise<ScrapeOutput> {
  const apiKey = getApiKey();

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

export async function scrapeWithFirecrawlStructured<T>(args: {
  url: string;
  schema: object;
  prompt: string;
  attempt?: number;
}): Promise<T | null> {
  const apiKey = getApiKey();
  const attempt = args.attempt ?? 1;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: args.url,
      formats: [{ type: "json", schema: args.schema, prompt: args.prompt }],
      onlyMainContent: false,
      waitFor: 2000,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `[scrape-json] upstream error ${res.status} for ${args.url}: ${text.slice(0, 500)}`,
    );
    if (res.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000));
      return scrapeWithFirecrawlStructured({
        ...args,
        attempt: attempt + 1,
      });
    }
    throw new Error("LLM extraction failed. Please try again later.");
  }

  const body = (await res.json()) as {
    success?: boolean;
    data?: { json?: T };
    json?: T;
    error?: string;
  };

  if (body.success === false) {
    console.error(`[scrape-json] success=false for ${args.url}: ${body.error ?? "unknown"}`);
    throw new Error("LLM extraction failed.");
  }

  return body.data?.json ?? body.json ?? null;
}
