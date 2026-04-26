/**
 * Server-side scraping helpers.
 *
 * The scraper first tries a plain HTTP fetch, which is enough for official
 * static size-guide pages such as Nike, adidas and PUMA. Firecrawl remains the
 * controlled fallback for JavaScript-rendered pages and modal-based guides.
 */

import * as cheerio from "cheerio";

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
    throw new Error("Le service de rendu JavaScript n'est pas configuré.");
  }
  return apiKey;
}

function hasApiKey(): boolean {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  return Boolean(apiKey && apiKey !== "fc-YOUR_FIRECRAWL_API_KEY");
}

function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  const chunks: string[] = [];

  $("h1, h2, h3, h4, h5, h6").each((_, node) => {
    const level = Number(node.tagName.slice(1));
    const text = $(node).text().replace(/\s+/g, " ").trim();
    if (text) chunks.push(`${"#".repeat(Math.min(level, 6))} ${text}`);
  });

  $("table").each((_, table) => {
    const rows = $(table)
      .find("tr")
      .toArray()
      .map((row) =>
        $(row)
          .find("th, td")
          .toArray()
          .map((cell) => $(cell).text().replace(/\s+/g, " ").trim()),
      )
      .filter((row) => row.some(Boolean));

    if (rows.length >= 2) {
      const width = Math.max(...rows.map((row) => row.length));
      const normalized = rows.map((row) => {
        const next = [...row];
        while (next.length < width) next.push("");
        return next;
      });
      chunks.push(normalized[0]!.join(" | "));
      chunks.push(Array.from({ length: width }, () => "---").join(" | "));
      for (const row of normalized.slice(1)) chunks.push(row.join(" | "));
    }
  });

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  if (bodyText) chunks.push(bodyText.slice(0, 12000));

  return chunks.join("\n\n");
}

function hasGuideSignal(output: ScrapeOutput): boolean {
  const text = `${output.html} ${output.markdown}`.toLowerCase();
  return (
    /<table\b/i.test(output.html) ||
    /\b(size|sizing|guide|chart|fit|taille|mesure|mens?|homme|chest|waist|hips)\b/i.test(text)
  );
}

export async function scrapeWithHttp(url: string): Promise<ScrapeOutput> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7",
      "User-Agent":
        "FitFetcher/1.0 (+https://github.com/Giscolab/fit-fetcher; size-guide validation)",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Échec HTTP ${response.status} lors de la récupération de la page.`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error("La source récupérée n'est pas une page HTML.");
  }

  const html = await response.text();
  if (!html.trim()) throw new Error("La page récupérée est vide.");

  return {
    html,
    markdown: htmlToMarkdown(html),
    sourceUrl: response.url || url,
  };
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
    throw new Error("Le scraping a échoué. Réessayez plus tard.");
  }

  const json = (await res.json()) as {
    success?: boolean;
    data?: { html?: string; markdown?: string; metadata?: { sourceURL?: string } };
    html?: string;
    markdown?: string;
    error?: string;
  };

  if (json.success === false) {
    console.error(
      `[scrape] upstream returned success=false for ${url}: ${json.error ?? "unknown"}`,
    );
    throw new Error("Le scraping a échoué. Réessayez plus tard.");
  }

  const html = json.data?.html ?? json.html ?? "";
  const markdown = json.data?.markdown ?? json.markdown ?? "";
  if (!html && !markdown) throw new Error("Aucun contenu exploitable n'a été récupéré.");

  return {
    html,
    markdown,
    sourceUrl: json.data?.metadata?.sourceURL ?? url,
  };
}

export async function scrapeSizeGuideDocument(url: string): Promise<ScrapeOutput> {
  const httpErrors: string[] = [];

  try {
    const staticOutput = await scrapeWithHttp(url);
    if (hasGuideSignal(staticOutput)) return staticOutput;
    httpErrors.push("La récupération HTTP n'a pas trouvé de signal de guide de tailles.");
  } catch (error) {
    httpErrors.push(error instanceof Error ? error.message : String(error));
  }

  if (!hasApiKey()) {
    throw new Error(
      `Aucune page statique exploitable et FIRECRAWL_API_KEY absent. Détails: ${httpErrors.join(" ")}`,
    );
  }

  return scrapeWithFirecrawl(url);
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
    throw new Error("L'extraction structurée a échoué. Réessayez plus tard.");
  }

  const body = (await res.json()) as {
    success?: boolean;
    data?: { json?: T };
    json?: T;
    error?: string;
  };

  if (body.success === false) {
    console.error(`[scrape-json] success=false for ${args.url}: ${body.error ?? "unknown"}`);
    throw new Error("L'extraction structurée a échoué.");
  }

  return body.data?.json ?? body.json ?? null;
}
