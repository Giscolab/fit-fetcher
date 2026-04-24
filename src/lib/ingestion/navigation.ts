import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import {
  containsAny,
  detectCategory,
  detectCategoryMapping,
  detectSizeSystem,
  normalizeToken,
  resolveRequestedCategoryMatch,
} from "@/lib/ingestion/taxonomy";
import type {
  CategoryMappingMode,
  DocumentKind,
  GarmentCategory,
  LinkCandidate,
  SizeSystem,
  SourceTraceStep,
  SourceType,
} from "@/lib/types";

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function makeId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

function registrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);
  return parts.slice(-2).join(".");
}

function isSameBrandUrl(currentUrl: string, candidateUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const candidate = new URL(candidateUrl);
    return registrableDomain(current.hostname) === registrableDomain(candidate.hostname);
  } catch {
    return false;
  }
}

function resolveLink(baseUrl: string, href?: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("javascript:")) {
    return null;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function collectHeadingPath(
  $: cheerio.CheerioAPI,
  element: Element,
): string[] {
  const headings: string[] = [];
  let current = $(element);

  while (current.length) {
    const previousHeading = current.prevAll("h1, h2, h3, h4, h5, h6").first();
    const text = cleanText(previousHeading.text());
    if (text && !headings.includes(text)) {
      headings.unshift(text);
    }
    current = current.parent();
  }

  return headings.slice(-3);
}

function collectNearbyText(
  $: cheerio.CheerioAPI,
  element: Element,
): string {
  const chunks: string[] = [];
  let previous = $(element).prev();
  while (previous.length && chunks.join(" ").length < 180) {
    if (previous.is("h1, h2, h3, h4, h5, h6")) break;
    const text = cleanText(previous.text());
    if (text) chunks.unshift(text);
    previous = previous.prev();
  }

  let next = $(element).next();
  while (next.length && chunks.join(" ").length < 280) {
    if (next.is("h1, h2, h3, h4, h5, h6")) break;
    const text = cleanText(next.text());
    if (text) chunks.push(text);
    next = next.next();
  }

  return chunks.join(" ").slice(0, 320);
}

function isGuideLikeLink(text: string): boolean {
  return containsAny(normalizeToken(text), [
    "size",
    "fit",
    "guide",
    "chart",
    "tops",
    "tees",
    "shirts",
    "apparel",
    "clothing",
    "homme",
    "femme",
    "women",
    "men",
  ]);
}

function scoreSizeSystemHint(
  requestedSizeSystem: SizeSystem | null,
  text: string,
  detectedSizeSystem: LinkCandidate["detectedSizeSystem"],
): { score: number; reasons: string[]; rejections: string[] } {
  const reasons: string[] = [];
  const rejections: string[] = [];
  const normalized = ` ${normalizeToken(text)} `;

  if (!requestedSizeSystem) {
    return { score: 0, reasons, rejections };
  }

  if (detectedSizeSystem === requestedSizeSystem) {
    reasons.push("Link context suggests the requested size system.");
    return { score: 2, reasons, rejections };
  }

  if (
    requestedSizeSystem === "INT" &&
    containsAny(normalized, [" international ", " alpha ", " xxs ", " xs ", " xl ", " 3xl "])
  ) {
    reasons.push("Link context includes international-size cues.");
    return { score: 1.5, reasons, rejections };
  }

  if (detectedSizeSystem !== "UNKNOWN") {
    rejections.push("Link context points to a different size system.");
    return { score: -1.5, reasons, rejections };
  }

  return { score: 0, reasons, rejections };
}

function scoreBrandFallbackBonus(url: string, text: string): {
  score: number;
  reason?: string;
} {
  const normalized = normalizeToken(`${url} ${text}`);

  if (containsAny(normalized, ["underarmour"])) {
    if (containsAny(normalized, ["top", "tops", "shirt", "shirts"])) {
      return {
        score: 1.5,
        reason: "Under Armour fallback favored an apparel tops link.",
      };
    }
  }

  if (containsAny(normalized, ["newbalance", "new balance"])) {
    if (containsAny(normalized, ["apparel", "clothing", "tops", "shirts"])) {
      return {
        score: 1.5,
        reason: "New Balance fallback favored apparel over footwear.",
      };
    }
    if (containsAny(normalized, ["shoe", "shoes", "footwear"])) {
      return {
        score: -2,
        reason: "New Balance fallback penalized footwear-only links for apparel requests.",
      };
    }
  }

  if (containsAny(normalized, ["puma", "adidas", "reebok"])) {
    if (containsAny(normalized, ["apparel", "clothing", "top", "tops", "shirt", "shirts"])) {
      return {
        score: 1,
        reason: "Brand fallback favored an apparel-oriented guide link.",
      };
    }
  }

  return { score: 0 };
}

function createLinkCandidate(args: {
  id: string;
  currentUrl: string;
  url: string;
  label: string;
  headingPath: string[];
  nearbyText: string;
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
  resolver: LinkCandidate["resolver"];
}): LinkCandidate {
  const label = cleanText(args.label) || cleanText(args.url);
  const context = [label, args.headingPath.join(" "), args.nearbyText, args.url].join(" ");
  const category = detectCategory({
    sectionTitle: label,
    headers: [],
    rowLabels: [],
    nearbyText: `${args.headingPath.join(" ")} ${args.nearbyText} ${args.url}`,
    fields: [],
  });
  const mapping = detectCategoryMapping({
    detectedCategory: category.detectedCategory,
    detectedCategoryLabel: category.detectedCategoryLabel,
    sectionTitle: label,
    nearbyText: args.nearbyText,
    fields: [],
  });
  const detectedSizeSystem = detectSizeSystem({
    rowLabels: [],
    headers: [],
    sizeAxisLabels: [],
    context,
  });
  const categoryMatch = resolveRequestedCategoryMatch({
    requestedCategory: args.requestedCategory,
    detectedCategory: category.detectedCategory,
    categoryMappingMode: mapping.mode,
  });

  const reasons: string[] = [];
  const rejectionReasons: string[] = [];
  let score = 0;

  if (isSameBrandUrl(args.currentUrl, args.url)) {
    score += 2;
    reasons.push("Link stays on the same brand domain.");
  } else {
    score -= 5;
    rejectionReasons.push("Link leaves the brand domain.");
  }

  if (args.url === args.currentUrl) {
    score -= 3;
    rejectionReasons.push("Link resolves to the same URL that was already fetched.");
  }

  if (isGuideLikeLink(context)) {
    score += 2;
    reasons.push("Link text or surrounding context looks guide-related.");
  }

  if (categoryMatch.mode === "exact") {
    score += 5;
    reasons.push("Link context matches the requested garment category.");
  } else if (categoryMatch.mode === "curated") {
    score += 4;
    reasons.push("Link context supports the curated broad-top mapping for tshirts.");
  } else if (category.detectedCategory === "generic-body-guide") {
    score -= 2;
    rejectionReasons.push("Link appears to point to a generic body guide.");
  } else if (
    args.requestedCategory &&
    category.detectedCategory !== "unknown" &&
    category.detectedCategory !== "tops" &&
    category.detectedCategory !== "bottoms"
  ) {
    score -= 4;
    rejectionReasons.push("Link context points to a different garment family.");
  }

  const sizeSystem = scoreSizeSystemHint(
    args.requestedSizeSystem,
    context,
    detectedSizeSystem,
  );
  score += sizeSystem.score;
  reasons.push(...sizeSystem.reasons);
  rejectionReasons.push(...sizeSystem.rejections);

  const fallback = scoreBrandFallbackBonus(args.url, context);
  score += fallback.score;
  if (fallback.reason) {
    if (fallback.score >= 0) {
      reasons.push(fallback.reason);
    } else {
      rejectionReasons.push(fallback.reason);
    }
  }

  if (containsAny(normalizeToken(context), ["shoe", "shoes", "footwear"])) {
    score -= args.requestedCategory === "tshirts" ? 4 : 1;
    rejectionReasons.push("Footwear-focused links are not valid for this apparel request.");
  }

  if (containsAny(normalizeToken(context), ["bottom", "bottoms", "pant", "pants", "inseam"])) {
    score -= args.requestedCategory === "tshirts" ? 3 : 0;
    if (args.requestedCategory === "tshirts") {
      rejectionReasons.push("Bottoms-focused links are not valid for this tops request.");
    }
  }

  return {
    id: args.id,
    url: args.url,
    label,
    headingPath: args.headingPath,
    nearbyText: args.nearbyText,
    detectedCategory: category.detectedCategory,
    detectedSizeSystem,
    categoryMappingMode: mapping.mode,
    categoryMappingReason: mapping.reason,
    score: Math.round(score * 100) / 100,
    reasons,
    rejectionReasons,
    selected: false,
    resolver: args.resolver,
  };
}

function dedupeLinks(links: LinkCandidate[]): LinkCandidate[] {
  const seen = new Map<string, LinkCandidate>();
  for (const link of links) {
    const existing = seen.get(link.url);
    if (!existing || existing.score < link.score) {
      seen.set(link.url, link);
    }
  }
  return Array.from(seen.values()).map((link, index) => ({
    ...link,
    id: makeId("link", index),
  }));
}

function discoverHtmlLinks(args: {
  html: string;
  sourceUrl: string;
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
}): LinkCandidate[] {
  const $ = cheerio.load(args.html);
  const links: LinkCandidate[] = [];

  $("a[href]").each((index, node) => {
    const url = resolveLink(args.sourceUrl, $(node).attr("href"));
    if (!url) return;

    const label = cleanText($(node).text()) || cleanText($(node).attr("title") ?? "");
    const headingPath = collectHeadingPath($, node);
    const nearbyText = collectNearbyText($, node);
    const context = `${label} ${headingPath.join(" ")} ${nearbyText} ${url}`;
    if (!isGuideLikeLink(context)) return;

    links.push(
      createLinkCandidate({
        id: makeId("link", index),
        currentUrl: args.sourceUrl,
        url,
        label,
        headingPath,
        nearbyText,
        requestedCategory: args.requestedCategory,
        requestedSizeSystem: args.requestedSizeSystem,
        resolver: "generic",
      }),
    );
  });

  return links;
}

function discoverMarkdownLinks(args: {
  markdown: string;
  sourceUrl: string;
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
}): LinkCandidate[] {
  const links: LinkCandidate[] = [];
  const lines = args.markdown.split(/\r?\n/);
  let headingPath: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim() ?? "";
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      headingPath = [...headingPath.slice(-2), cleanText(headingMatch[2])];
      continue;
    }

    const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = markdownLinkPattern.exec(line))) {
      const url = resolveLink(args.sourceUrl, match[2]);
      if (!url) continue;
      const label = cleanText(match[1]);
      const nearbyText = cleanText(
        [lines[index - 1] ?? "", line, lines[index + 1] ?? ""].join(" "),
      );
      const context = `${label} ${headingPath.join(" ")} ${nearbyText} ${url}`;
      if (!isGuideLikeLink(context)) continue;

      links.push(
        createLinkCandidate({
          id: makeId("link-md", links.length),
          currentUrl: args.sourceUrl,
          url,
          label,
          headingPath,
          nearbyText,
          requestedCategory: args.requestedCategory,
          requestedSizeSystem: args.requestedSizeSystem,
          resolver: "generic",
        }),
      );
    }
  }

  return links;
}

export function discoverLinkCandidates(args: {
  html: string;
  markdown: string;
  sourceUrl: string;
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
}): LinkCandidate[] {
  return dedupeLinks([
    ...discoverHtmlLinks(args),
    ...discoverMarkdownLinks(args),
  ]).sort((a, b) => b.score - a.score);
}

function countTableLikeSignals(html: string, markdown: string): number {
  const tableCount =
    (html.match(/<table\b/gi) ?? []).length +
    (html.match(/role=["']table["']/gi) ?? []).length;
  const markdownCount = (markdown.match(/^\|.+\|$/gm) ?? []).length;
  const measurementSignals = (markdown.match(/\b(chest|waist|hips|inseam|foot length)\b/gi) ?? [])
    .length;
  return tableCount + Math.floor(markdownCount / 2) + Math.min(measurementSignals, 4);
}

export function classifyDocument(args: {
  html: string;
  markdown: string;
  sourceUrl: string;
  linkCandidates: LinkCandidate[];
}): {
  documentKind: DocumentKind;
  sourceType: SourceType;
  reasoning: string[];
} {
  const reasoning: string[] = [];
  const linkCount = args.linkCandidates.filter((candidate) => candidate.score > 1).length;
  const tableLikeSignals = countTableLikeSignals(args.html, args.markdown);
  const lowerUrl = args.sourceUrl.toLowerCase();

  if (tableLikeSignals === 0 && linkCount >= 2) {
    reasoning.push("Guide-related links were found, but no table-like guide blocks were present.");
    return {
      documentKind: "guide-hub-page",
      sourceType: "guide-hub-page",
      reasoning,
    };
  }

  if (
    tableLikeSignals >= 3 ||
    linkCount >= 3 ||
    /(size-fit-guide|size-guide|size-chart|guide-des-tailles)/.test(lowerUrl)
  ) {
    reasoning.push("Multiple guide/table signals suggest a multi-guide document.");
    return {
      documentKind: "multi-guide-page",
      sourceType: "generic-multi-guide-page",
      reasoning,
    };
  }

  if (tableLikeSignals > 0) {
    reasoning.push("Table-like guide content was detected directly on the fetched page.");
    return {
      documentKind: "direct-guide-page",
      sourceType: /(product|sku|\/p\/|\/products\/)/.test(lowerUrl)
        ? "product-page-size-guide"
        : "category-specific-page",
      reasoning,
    };
  }

  reasoning.push("No usable guide blocks or strong guide navigation were found.");
  return {
    documentKind: "unrelated-page",
    sourceType: "category-specific-page",
    reasoning,
  };
}

export function selectNavigableLink(args: {
  linkCandidates: LinkCandidate[];
  documentKind: DocumentKind;
}): {
  linkCandidates: LinkCandidate[];
  selected?: LinkCandidate;
  reasoning: string[];
  navigationConfidence: number;
} {
  const sorted = [...args.linkCandidates].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const runnerUp = sorted[1];
  const minScore = args.documentKind === "guide-hub-page" ? 4.5 : 5.5;
  const minGap = args.documentKind === "guide-hub-page" ? 1 : 1.5;
  const selected =
    top && top.score >= minScore && (!runnerUp || top.score - runnerUp.score >= minGap)
      ? top
      : undefined;
  const reasoning: string[] = [];

  if (selected) {
    reasoning.push(`Followed internal guide link "${selected.label}" with score ${selected.score}.`);
    reasoning.push(...selected.reasons.slice(0, 4));
  } else if (top) {
    reasoning.push(
      `No internal link was clear enough to follow automatically. Best link "${top.label}" scored ${top.score}.`,
    );
    if (runnerUp) {
      reasoning.push(
        `Runner-up "${runnerUp.label}" scored ${runnerUp.score}, so the navigation match was not unique enough.`,
      );
    }
    reasoning.push(...top.rejectionReasons.slice(0, 4));
  } else {
    reasoning.push("No internal guide links were discovered.");
  }

  return {
    linkCandidates: sorted.map((candidate) => ({
      ...candidate,
      selected: candidate.id === selected?.id,
    })),
    selected,
    reasoning,
    navigationConfidence: selected ? Math.min(0.98, 0.35 + selected.score / 10) : 0,
  };
}

export function buildFollowTraceStep(link: LinkCandidate): SourceTraceStep {
  return {
    kind: link.resolver === "brand-fallback" ? "brand-fallback" : "followed-link",
    url: link.url,
    label: link.label,
    confidence: Math.min(0.98, 0.35 + link.score / 10),
    reasons: [...link.reasons],
  };
}
