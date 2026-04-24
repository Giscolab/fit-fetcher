import * as cheerio from "cheerio";
import { discoverCandidateSections } from "@/lib/ingestion/discovery";
import { runIngestionPipeline } from "@/lib/ingestion/pipeline";
import { scrapeWithFirecrawl } from "@/lib/utils/firecrawl";
import type {
  BrandSource,
  CandidateSection,
  DocumentKind,
  GeneratedGuide,
  HopAttempt,
  HubLinkCandidate,
  IngestionPipelineReport,
} from "@/lib/types";

const MAX_FOLLOW_LINKS = 2;
const MIN_LINK_SCORE = 3;

/* ---------- Stage 0: document classification ---------- */

const SIZE_GUIDE_HINTS = [
  "size",
  "taille",
  "fit",
  "guide",
  "chart",
  "measurement",
  "mesure",
];

function looksLikeSizePage(html: string): boolean {
  const lower = html.toLowerCase();
  return SIZE_GUIDE_HINTS.some((hint) => lower.includes(hint));
}

function countSizeRelatedLinks($: cheerio.CheerioAPI, sourceHost: string): number {
  let count = 0;
  $("a[href]").each((_, node) => {
    const href = $(node).attr("href") ?? "";
    const text = ($(node).text() ?? "").toLowerCase();
    let host = "";
    try {
      host = new URL(href, `https://${sourceHost}`).hostname.toLowerCase();
    } catch {
      return;
    }
    if (host !== sourceHost) return;
    const target = `${href} ${text}`.toLowerCase();
    if (
      /(size|taille|fit|guide|chart)/.test(target) &&
      !/(privacy|cookie|terms|legal|account|wishlist|cart|login)/.test(target)
    ) {
      count += 1;
    }
  });
  return count;
}

function tabularCandidatesWithMeasurements(
  candidates: CandidateSection[],
): CandidateSection[] {
  return candidates.filter(
    (candidate) =>
      candidate.isTabular &&
      candidate.visibleRowLabels.length >= 2 &&
      candidate.visibleColumnLabels.some((header) =>
        /(chest|bust|waist|hip|inseam|sleeve|neck|shoulder|height|foot|cm|in)/i.test(
          header,
        ),
      ),
  );
}

function distinctCategoryCount(candidates: CandidateSection[]): number {
  return new Set(
    candidates
      .map((candidate) => candidate.detectedCategory)
      .filter((category) => category !== "unknown"),
  ).size;
}

export function classifyDocument(args: {
  html: string;
  markdown: string;
  sourceUrl: string;
  candidates: CandidateSection[];
}): { kind: DocumentKind; reasons: string[] } {
  const reasons: string[] = [];
  const usable = tabularCandidatesWithMeasurements(args.candidates);
  const distinctCategories = distinctCategoryCount(usable);

  let host = "";
  try {
    host = new URL(args.sourceUrl).hostname.toLowerCase();
  } catch {
    host = "";
  }

  const $ = cheerio.load(args.html);
  const sizeLinkCount = host ? countSizeRelatedLinks($, host) : 0;

  if (usable.length === 0 && sizeLinkCount === 0 && !looksLikeSizePage(args.html)) {
    reasons.push("No structured tables, no size-related links, no size keywords.");
    return { kind: "irrelevant", reasons };
  }

  if (usable.length === 0 && sizeLinkCount >= 4) {
    reasons.push(
      `No measurement tables on this page, but ${sizeLinkCount} same-domain size-related links suggest a hub.`,
    );
    return { kind: "guide-hub-page", reasons };
  }

  if (usable.length >= 2 && distinctCategories >= 2) {
    reasons.push(
      `Page contains ${usable.length} measurement tables across ${distinctCategories} distinct categories.`,
    );
    return { kind: "multi-guide-page", reasons };
  }

  if (usable.length >= 1 && distinctCategories <= 1) {
    reasons.push(
      `Page exposes ${usable.length} measurement table(s) for a single category.`,
    );
    return { kind: "direct-guide-page", reasons };
  }

  if (sizeLinkCount >= 4) {
    reasons.push(
      `Tables present but ambiguous; ${sizeLinkCount} size-related links suggest a hub view.`,
    );
    return { kind: "guide-hub-page", reasons };
  }

  reasons.push("Falling back to multi-guide classification.");
  return { kind: "multi-guide-page", reasons };
}

/* ---------- Stage 1: scored one-hop link selection ---------- */

interface LinkRule {
  pattern: RegExp;
  weight: number;
}

const LINK_SCORING_RULES: LinkRule[] = [
  { pattern: /\b(men|mens|man)\b/i, weight: 3 },
  { pattern: /\b(top|tops|shirt|shirts|tee|tees|t-shirt)\b/i, weight: 3 },
  { pattern: /\bsize\b/i, weight: 2 },
  { pattern: /\b(chart|guide|conversion)\b/i, weight: 2 },
  { pattern: /\b(shoe|shoes|footwear|sneaker|trainer)\b/i, weight: -3 },
  { pattern: /\b(pant|pants|trouser|trousers|bottom|bottoms|short|shorts)\b/i, weight: -3 },
  { pattern: /\b(kid|kids|baby|infant|junior|children)\b/i, weight: -5 },
  { pattern: /\b(women|woman|female|ladies|lady)\b/i, weight: -2 },
];

function normalizeUrl(raw: string, base: string): URL | null {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}

function isPublicHttpUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (
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
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return false;
  }
  return true;
}

function canonicalizeUrl(url: URL): string {
  url.hash = "";
  return url.toString();
}

function scoreLink(href: string, anchorText: string): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  const probe = `${href} ${anchorText}`;
  let score = 0;
  for (const rule of LINK_SCORING_RULES) {
    if (rule.pattern.test(probe)) {
      score += rule.weight;
      reasons.push(
        `${rule.weight > 0 ? "+" : ""}${rule.weight} ${rule.pattern.source}`,
      );
    }
  }
  return { score, reasons };
}

export function scoreHubLinks(args: {
  html: string;
  sourceUrl: string;
}): HubLinkCandidate[] {
  const $ = cheerio.load(args.html);
  const sourceUrl = (() => {
    try {
      return new URL(args.sourceUrl);
    } catch {
      return null;
    }
  })();
  if (!sourceUrl) return [];

  const sourceHost = sourceUrl.hostname.toLowerCase();
  const sourceCanonical = canonicalizeUrl(new URL(sourceUrl.toString()));
  const seen = new Map<string, HubLinkCandidate>();

  $("a[href]").each((_, node) => {
    const rawHref = $(node).attr("href") ?? "";
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("mailto:")) {
      return;
    }
    const url = normalizeUrl(rawHref, args.sourceUrl);
    if (!url || !isPublicHttpUrl(url)) return;
    if (url.hostname.toLowerCase() !== sourceHost) return;

    const canonical = canonicalizeUrl(new URL(url.toString()));
    if (canonical === sourceCanonical) return;

    const anchorText = ($(node).text() ?? "").replace(/\s+/g, " ").trim();
    const { score, reasons } = scoreLink(canonical, anchorText);
    if (score < MIN_LINK_SCORE) return;

    const existing = seen.get(canonical);
    if (!existing || existing.score < score) {
      seen.set(canonical, {
        url: canonical,
        anchorText: anchorText.slice(0, 200),
        score,
        reasons,
      });
    }
  });

  return Array.from(seen.values()).sort((a, b) => b.score - a.score);
}

/* ---------- orchestrator: classify -> optionally one-hop follow ---------- */

interface ResolveArgs {
  source: BrandSource;
  initialUrl: string;
  log?: (line: string) => void;
}

interface ResolveResult {
  guide?: GeneratedGuide;
  report: IngestionPipelineReport;
}

function defaultLog(_line: string): void {
  /* noop */
}

function recordHop(
  hopAttempts: HopAttempt[],
  attempt: HopAttempt,
): HopAttempt[] {
  return [...hopAttempts, attempt];
}

interface FetchAndRunOutcome {
  result: ResolveResult;
  documentKind: DocumentKind;
  fetchedUrl: string;
  html: string;
}

async function fetchAndRun(args: {
  source: BrandSource;
  url: string;
  followedFromUrl?: string;
  log: (line: string) => void;
}): Promise<FetchAndRunOutcome> {
  args.log(
    `Fetching ${args.url}${args.followedFromUrl ? ` (followed from ${args.followedFromUrl})` : ""}`,
  );
  const scraped = await scrapeWithFirecrawl(args.url);
  args.log(
    `Fetched ${scraped.html.length} chars HTML and ${scraped.markdown.length} chars markdown.`,
  );

  const discovered = discoverCandidateSections({
    html: scraped.html,
    markdown: scraped.markdown,
    sourceUrl: scraped.sourceUrl,
  });

  const classification = classifyDocument({
    html: scraped.html,
    markdown: scraped.markdown,
    sourceUrl: scraped.sourceUrl,
    candidates: discovered.candidates,
  });

  args.log(`Stage 0 classification: ${classification.kind}`);
  for (const reason of classification.reasons) args.log(`   ${reason}`);

  const pipelineRun = await runIngestionPipeline({
    source: args.source,
    fetchedUrl: scraped.sourceUrl,
    html: scraped.html,
    markdown: scraped.markdown,
  });

  const report: IngestionPipelineReport = {
    ...pipelineRun.report,
    documentKind: classification.kind,
    followedFromUrl: args.followedFromUrl,
  };

  return {
    result: { guide: pipelineRun.guide, report },
    documentKind: classification.kind,
    fetchedUrl: scraped.sourceUrl,
    html: scraped.html,
  };
}

function pickBetter(a: ResolveResult, b: ResolveResult): ResolveResult {
  if (a.guide && !b.guide) return a;
  if (b.guide && !a.guide) return b;
  if (a.guide && b.guide) {
    const aRows = a.guide.guide.rows.length;
    const bRows = b.guide.guide.rows.length;
    return bRows > aRows ? b : a;
  }
  const aCandidates = a.report.discoveredCandidates.length;
  const bCandidates = b.report.discoveredCandidates.length;
  return bCandidates > aCandidates ? b : a;
}

export async function resolveSizeGuide(args: ResolveArgs): Promise<ResolveResult> {
  const log = args.log ?? defaultLog;
  const visited = new Set<string>();
  let hopAttempts: HopAttempt[] = [];

  const initialNormalized = normalizeUrl(args.initialUrl, args.initialUrl);
  if (initialNormalized) {
    visited.add(canonicalizeUrl(initialNormalized));
  }

  let initial: Awaited<ReturnType<typeof fetchAndRun>>;
  try {
    initial = await fetchAndRun({ source: args.source, url: args.initialUrl, log });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR fetching initial page: ${message}`);
    throw err;
  }

  hopAttempts = recordHop(hopAttempts, {
    url: initial.fetchedUrl,
    documentKind: initial.documentKind,
    candidatesDiscovered: initial.result.report.discoveredCandidates.length,
    selectedCandidateId: initial.result.report.selectedCandidateId,
    validationStatus: initial.result.report.validationStatus,
    outcome: initial.result.guide ? "accepted" : "rejected",
  });

  if (initial.result.guide) {
    return {
      guide: initial.result.guide,
      report: { ...initial.result.report, hopAttempts },
    };
  }

  if (initial.documentKind === "irrelevant") {
    log("Stage 1 skipped: page classified as irrelevant.");
    return {
      report: {
        ...initial.result.report,
        hopAttempts,
        validationErrors: [
          ...initial.result.report.validationErrors,
          {
            code: "irrelevant-document",
            message: "The fetched page does not look like a size-guide source.",
            severity: "error",
          },
        ],
        manualReviewRecommended: true,
      },
    };
  }

  if (initial.documentKind !== "guide-hub-page") {
    return {
      report: { ...initial.result.report, hopAttempts },
    };
  }

  // Stage 1: one-hop internal follow (reuse the HTML we already fetched)
  const links = scoreHubLinks({
    html: initial.html,
    sourceUrl: initial.fetchedUrl,
  });

  log(
    `Stage 1 hub follow: scored ${links.length} candidate link(s) above threshold ${MIN_LINK_SCORE}.`,
  );

  if (links.length === 0) {
    return {
      report: {
        ...initial.result.report,
        hopAttempts,
        validationErrors: [
          ...initial.result.report.validationErrors,
          {
            code: "hub-no-follow-links",
            message:
              "Page classified as a guide hub but no internal link scored high enough to follow safely.",
            severity: "error",
          },
        ],
        manualReviewRecommended: true,
      },
    };
  }

  const followCandidates = links
    .filter((link) => !visited.has(link.url))
    .slice(0, MAX_FOLLOW_LINKS);

  if (followCandidates.length === 0) {
    return {
      report: {
        ...initial.result.report,
        hopAttempts,
        validationErrors: [
          ...initial.result.report.validationErrors,
          {
            code: "hub-already-visited",
            message:
              "All scored hub links resolved to URLs that have already been visited.",
            severity: "error",
          },
        ],
        manualReviewRecommended: true,
      },
    };
  }

  let best: ResolveResult = initial.result;

  for (const link of followCandidates) {
    visited.add(link.url);

    log(
      `Following link (score ${link.score}): "${link.anchorText || "(no text)"}" → ${link.url}`,
    );

    let attemptResult: Awaited<ReturnType<typeof fetchAndRun>>;
    try {
      attemptResult = await fetchAndRun({
        source: args.source,
        url: link.url,
        followedFromUrl: initial.fetchedUrl,
        log,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`   Hop fetch failed: ${message}`);
      hopAttempts = recordHop(hopAttempts, {
        url: link.url,
        followedFromUrl: initial.fetchedUrl,
        documentKind: "irrelevant",
        candidatesDiscovered: 0,
        validationStatus: "rejected",
        outcome: "fetch-error",
        errorMessage: message,
      });
      continue;
    }

    hopAttempts = recordHop(hopAttempts, {
      url: attemptResult.fetchedUrl,
      followedFromUrl: initial.fetchedUrl,
      documentKind: attemptResult.documentKind,
      candidatesDiscovered:
        attemptResult.result.report.discoveredCandidates.length,
      selectedCandidateId: attemptResult.result.report.selectedCandidateId,
      validationStatus: attemptResult.result.report.validationStatus,
      outcome: attemptResult.result.guide ? "accepted" : "rejected",
    });

    if (attemptResult.documentKind === "guide-hub-page") {
      log("   Hop landed on another hub; not descending further (1-hop limit).");
    }

    if (attemptResult.result.guide) {
      return {
        guide: attemptResult.result.guide,
        report: { ...attemptResult.result.report, hopAttempts },
      };
    }

    best = pickBetter(best, attemptResult.result);
  }

  return {
    report: {
      ...best.report,
      hopAttempts,
      manualReviewRecommended: true,
    },
  };
}
