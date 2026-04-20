/**
 * Scrape helper. Server-only — uses FIRECRAWL_API_KEY from env.
 * Returns html + markdown for downstream extraction.
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

/* ------------------------------------------------------------------ */
/*  Firecrawl JSON extraction (LLM-powered structured output)         */
/* ------------------------------------------------------------------ */

export interface FirecrawlJsonRow {
  label: string | null;
  chest_cm_min: number | null;
  chest_cm_max: number | null;
  waist_cm_min: number | null;
  waist_cm_max: number | null;
  hips_cm_min: number | null;
  hips_cm_max: number | null;
  inseam_cm_min: number | null;
  inseam_cm_max: number | null;
}

export interface FirecrawlJsonResult {
  rows: FirecrawlJsonRow[];
  unit_detected: "cm" | "in" | "unknown" | null;
}

const SIZE_GUIDE_SCHEMA = {
  type: "object",
  properties: {
    unit_detected: {
      type: "string",
      enum: ["cm", "in", "unknown"],
      description: "The measurement unit used on the page (cm, in, or unknown).",
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Size label, e.g. S, M, L, XL, 38, 40" },
          chest_cm_min: { type: "number", description: "Chest min in cm" },
          chest_cm_max: { type: "number", description: "Chest max in cm" },
          waist_cm_min: { type: "number", description: "Waist min in cm" },
          waist_cm_max: { type: "number", description: "Waist max in cm" },
          hips_cm_min: { type: "number", description: "Hips min in cm" },
          hips_cm_max: { type: "number", description: "Hips max in cm" },
          inseam_cm_min: { type: "number", description: "Inseam min in cm" },
          inseam_cm_max: { type: "number", description: "Inseam max in cm" },
        },
        required: ["label"],
      },
    },
  },
  required: ["rows"],
} as const;

const JSON_PROMPT =
  "Extract every size from the size guide table on this page. " +
  "Convert all measurements to centimetres. " +
  "If a measurement is a single value, use it for both min and max. " +
  "If inches are used, multiply by 2.54 to convert to cm. " +
  "Return null for any measurement not present.";

export async function scrapeWithFirecrawlJson(
  url: string,
  attempt = 1,
): Promise<FirecrawlJsonResult> {
  const apiKey = getApiKey();

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: [{ type: "json", schema: SIZE_GUIDE_SCHEMA, prompt: JSON_PROMPT }],
      onlyMainContent: false,
      waitFor: 2000,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[scrape-json] upstream error ${res.status} for ${url}: ${text.slice(0, 500)}`);
    if (res.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000));
      return scrapeWithFirecrawlJson(url, attempt + 1);
    }
    throw new Error("LLM extraction failed. Please try again later.");
  }

  const body = (await res.json()) as {
    success?: boolean;
    data?: { json?: FirecrawlJsonResult };
    json?: FirecrawlJsonResult;
    error?: string;
  };

  if (body.success === false) {
    console.error(`[scrape-json] success=false for ${url}: ${body.error ?? "unknown"}`);
    throw new Error("LLM extraction failed.");
  }

  const extracted = body.data?.json ?? body.json;
  if (!extracted || !Array.isArray(extracted.rows)) {
    return { rows: [], unit_detected: null };
  }

  return extracted;
}
