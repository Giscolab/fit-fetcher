/**
 * Scrape helpers. Server-only — uses FIRECRAWL_API_KEY from env.
 * - scrapeWithFirecrawl: returns html + markdown for heuristic extraction.
 * - scrapeWithFirecrawlJson: returns LLM-extracted structured JSON via Firecrawl.
 */

const ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const PLACEHOLDER_API_KEYS = new Set(["fc-YOUR_FIRECRAWL_API_KEY", "fc-ta-vraie-cle-firecrawl"]);

export interface ScrapeOutput {
  html: string;
  markdown: string;
  sourceUrl: string;
}

function getApiKey(): string {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey || PLACEHOLDER_API_KEYS.has(apiKey)) {
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

/**
 * JSON schema for size guide LLM extraction. All measurements expressed in centimeters.
 * Single values (e.g. "96") should be returned as min == max.
 */
export const SIZE_GUIDE_JSON_SCHEMA = {
  type: "object",
  properties: {
    unit_detected: {
      type: "string",
      enum: ["cm", "in", "unknown"],
      description: "The original unit used on the page before conversion.",
    },
    rows: {
      type: "array",
      description: "One entry per size offered in the guide.",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Size label, e.g. S, M, L, 42, 32/34" },
          chest_cm_min: { type: ["number", "null"] },
          chest_cm_max: { type: ["number", "null"] },
          waist_cm_min: { type: ["number", "null"] },
          waist_cm_max: { type: ["number", "null"] },
          hips_cm_min: { type: ["number", "null"] },
          hips_cm_max: { type: ["number", "null"] },
          inseam_cm_min: { type: ["number", "null"] },
          inseam_cm_max: { type: ["number", "null"] },
        },
        required: ["label"],
      },
    },
  },
  required: ["rows"],
} as const;

export interface FirecrawlJsonRow {
  label: string;
  chest_cm_min?: number | null;
  chest_cm_max?: number | null;
  waist_cm_min?: number | null;
  waist_cm_max?: number | null;
  hips_cm_min?: number | null;
  hips_cm_max?: number | null;
  inseam_cm_min?: number | null;
  inseam_cm_max?: number | null;
}

export interface FirecrawlJsonResult {
  unit_detected?: "cm" | "in" | "unknown";
  rows: FirecrawlJsonRow[];
}

const LLM_PROMPT = [
  "Extract the apparel size guide from this page.",
  "Return ALL sizes available (e.g. XXS, XS, S, M, L, XL, XXL, or numeric like 38/40/42).",
  "For every size, capture chest, waist, hips and inseam measurements when present.",
  "ALWAYS convert measurements to centimeters (cm). If the page uses inches, multiply by 2.54.",
  "If a measurement is a range (e.g. '88-96'), use the min and max. If a single value, set min = max.",
  "If a measurement is missing, leave it as null. Do not invent values.",
  "Set unit_detected to the original unit shown on the page ('cm', 'in', or 'unknown').",
  "If the page contains multiple guides (men/women/kids/categories), pick the one most relevant to adult t-shirts/tops by default.",
].join(" ");

/** LLM-powered fallback: ask Firecrawl to extract a structured size guide. */
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
      formats: [
        {
          type: "json",
          schema: SIZE_GUIDE_JSON_SCHEMA,
          prompt: LLM_PROMPT,
        },
      ],
      onlyMainContent: false,
      waitFor: 2000,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `[scrape:json] upstream error ${res.status} for ${url}: ${text.slice(0, 500)}`,
    );
    if (res.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000));
      return scrapeWithFirecrawlJson(url, attempt + 1);
    }
    throw new Error("LLM extraction failed. Please try again later.");
  }

  const json = (await res.json()) as {
    success?: boolean;
    data?: { json?: FirecrawlJsonResult };
    json?: FirecrawlJsonResult;
    error?: string;
  };

  if (json.success === false) {
    console.error(
      `[scrape:json] upstream returned success=false for ${url}: ${json.error ?? "unknown"}`,
    );
    throw new Error("LLM extraction failed. Please try again later.");
  }

  const payload = json.data?.json ?? json.json;
  if (!payload || !Array.isArray(payload.rows)) {
    return { rows: [] };
  }
  return payload;
}
