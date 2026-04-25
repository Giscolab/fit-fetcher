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

function brandDomainKey(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const aliasMap: Array<[RegExp, string]> = [
    [/calvinklein\.(?:com|us)$/, "calvinklein"],
    [/(?:usa\.)?tommy\.com$/, "tommyhilfiger"],
    [/tommyhilfiger\./, "tommyhilfiger"],
    [/underarmour\./, "underarmour"],
    [/newbalance\./, "newbalance"],
    [/hugoboss\./, "hugoboss"],
    [/ralphlauren\./, "ralphlauren"],
    [/thenorthface\./, "thenorthface"],
    [/columbia\./, "columbia"],
    [/lacoste\./, "lacoste"],
  ];
  const alias = aliasMap.find(([pattern]) => pattern.test(host));
  return alias?.[1] ?? registrableDomain(host);
}

function isSameBrandUrl(currentUrl: string, candidateUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const candidate = new URL(candidateUrl);
    return brandDomainKey(current.hostname) === brandDomainKey(candidate.hostname);
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

function isUnsupportedFetchTarget(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|mp4|mpeg|mov|webm|zip|rar|7z)(?:$|[?#])/.test(
      pathname,
    );
  } catch {
    return /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|mp4|mpeg|mov|webm|zip|rar|7z)(?:$|[?#])/i.test(
      url,
    );
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

// ── Mots-clés multilingues pour la navigation ──────────────────────────

const MEN_KEYWORDS = ["men", "mens", "homme", "hommes", "man", "male"];
const TOPS_KEYWORDS = [
  "top", "tops", "haut", "hauts",
  "shirt", "shirts", "chemise", "chemises",
  "tee", "tees", "t-shirt", "t-shirts",
  "tshirt", "tshirts",
];
const BOTTOMS_KEYWORDS = [
  "pant", "pants", "trouser", "trousers", "pantalon", "pantalons",
  "bottom", "bottoms", "bas", "jean", "jeans", "short", "shorts",
  "inseam", "entrejambe",
];
const SIZE_KEYWORDS = [
  "size", "taille", "tailles", "fit", "guide",
  "chart", "charts", "alpha", "officiel", "official",
  "sizing", "measurement", "measurements", "mesure", "mesures",
  "sizeguide", "sizeguides", "sizechart", "sizecharts",
  "guide des tailles", "tableau des tailles",
];
const FOOTWEAR_KEYWORDS = [
  "shoe", "shoes", "footwear", "chaussure", "chaussures",
  "foot length", "foot width",
];
const KIDS_KEYWORDS = [
  "kid", "kids", "child", "children", "junior",
  "baby", "infant", "toddler", "bebe", "bébé", "enfant", "enfants",
];
const UTILITY_KEYWORDS = [
  "skip to footer content", "skip to main content", "skip to content",
  "acceder au contenu principal", "accéder au contenu principal",
  "main content", "create account", "sign in", "log in", "login",
  "cart", "bag", "wishlist", "menu", "search",
  "send us feedback", "site feedback", "your opinion counts",
  "contact us", "customer service", "help", "support",
  "accessibility", "privacy", "terms", "newsletter",
  "cookie", "cookie settings", "change country", "store locator",
  "find a store", "sitemap", "promotions", "student promotion",
  "digital greeting card", "authenticity", "payment methods",
  "saved items", "styling book", "style guide", "gift guide",
  "denim fit guide",
  "gifts for him", "gifts for her", "gifts for mom",
  "spring selection", "summer selection", "new arrivals",
  "sale", "deals", "uniqlo u",
  "shop by gender", "gender",
  "explore", "my account", "account",
];

// ── Fonctions de scoring multilingues ──────────────────────────────────

function isGuideLikeLink(text: string): boolean {
  const normalized = normalizeToken(text);
  if (containsAny(normalized, SIZE_KEYWORDS)) return true;
  if (containsAny(normalized, TOPS_KEYWORDS)) return true;
  if (containsAny(normalized, ["apparel", "clothing", "vetement", "vêtement", "vetements", "vêtements"])) return true;
  return false;
}

function isProductPageLink(url: string, text: string): boolean {
  const raw = `${text} ${url}`;
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  const search = (() => {
    try {
      return new URL(url).search.toLowerCase();
    } catch {
      return "";
    }
  })();
  const hasGuideSignal =
    /\b(size|chart|guide|alpha|measurement|measurements|taille|tailles|officiel)\b/i.test(raw) ||
    /size[-_/]?(fit|chart|guide)/i.test(url) ||
    /mens?[-_]?tops?[-_]?alpha|mens?_tops?_alpha|tops?[-_]?alpha|apparel[-_/]size/i.test(path);
  const hasPrice = /[$]\s?\d/.test(text) || /\b(?:usd|gbp|cad|aud)\s?\d/i.test(text);
  const hasProductPath =
    /\/(?:p|product|products|sku)\//i.test(path) ||
    /\/t\/(?!size-guide(?:\/|$))[^/?#]+/i.test(path) ||
    /\/(?:lacoste|homme|femme|men|women)\/.+\/[^/]+\.html$/i.test(path);
  const hasProductQuery =
    /(?:^|[?&])(?:color|size|sku|pid|productid)=/i.test(search) ||
    /%22|%27|["']/.test(url);
  const hasProductTitle =
    !hasGuideSignal &&
    (/\b(?:nike|adidas|puma|reebok|new balance|under armour)\b.*\b(?:t[\s-]?shirt|tee|shirt|hoodie|pants?|shorts?)\b/i.test(
      raw,
    ) ||
      /\b(?:dri[\s-]?fit|drycell|climacool|heatgear|coldgear|nb dry)\b/i.test(raw) ||
      /\bmen'?s\b.*\b(?:fitness|training|running|basketball|graphic)\b.*\b(?:t[\s-]?shirt|tee|shirt)\b/i.test(
        raw,
      ));
  const genericProductTitle =
    !hasGuideSignal &&
    /\bproduct\b/i.test(text) &&
    /\b(?:t[\s-]?shirt|tee|shirt|hoodie|pants?|shorts?)\b/i.test(text);

  return hasPrice || hasProductPath || hasProductQuery || hasProductTitle || genericProductTitle;
}

function isUtilityNavigationLink(label: string, url: string): boolean {
  const normalizedLabel = normalizeToken(label);
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();

  // Ne jamais rejeter un lien qui a un signal de guide de taille
  if (containsAny(normalizedLabel, SIZE_KEYWORDS)) return false;
  if (containsAny(normalizedLabel, TOPS_KEYWORDS)) return false;
  if (containsAny(normalizedLabel, ["apparel", "clothing"])) return false;

  // Ancres et liens de navigation interne
  if (/^\/?(?:#|main|content|skip)/.test(path)) return true;

  // Mots-clés utilitaires multilingues
  if (containsAny(normalizedLabel, UTILITY_KEYWORDS)) return true;

  return false;
}

function isBadMarketingOrUtilityTarget(url: string, label: string): boolean {
  const normalized = normalizeToken(`${label} ${url}`);
  const parsed = (() => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  })();
  const path = parsed?.pathname.toLowerCase() ?? url.toLowerCase();
  const hash = parsed?.hash.toLowerCase() ?? "";
  const search = parsed?.search.toLowerCase() ?? "";
  const normalizedLabel = normalizeToken(label);
  const labelHasConcreteSizeSignal = containsAny(normalizedLabel, [
    "size chart",
    "size charts",
    "size guide",
    "size guides",
    "size fit",
    "guide des tailles",
    "tableau des tailles",
    "mens tops alpha",
    "men tops alpha",
  ]);

  if (/%22|%27|["']/.test(url)) return true;
  if (containsAny(normalizedLabel, UTILITY_KEYWORDS) && !labelHasConcreteSizeSignal) return true;
  if (hasConcreteSizeGuideLinkSignal(url, label)) return false;
  if (containsAny(normalized, UTILITY_KEYWORDS)) return true;
  if (/cookie|change[-_ ]?country/.test(hash)) return true;
  if (/(?:^|[?&])(?:color|size|sku|pid|productid)=/i.test(search)) return true;

  return /\/(?:stores?|store-locator|retail|promotions?|gift|gifts|stylingbook|stories|journal|rlmag|wishlist|saved-items|payment-methods|sitemap|privacy|terms|authenticity|student-promotions|digital-card|help|faq)(?:\/|$)/i.test(
    path,
  );
}

function hasConcreteSizeGuideLinkSignal(url: string, text: string): boolean {
  const raw = `${text} ${url}`;
  const normalized = ` ${normalizeToken(raw)} `;
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  const guideSignal =
    containsAny(normalized, [
      "size chart",
      "size charts",
      "size guide",
      "size guides",
      "size fit",
      "sizeguide",
      "sizeguides",
      "sizechart",
      "sizecharts",
      "guide des tailles",
      "tableau des tailles",
      "mens tops alpha",
      "men tops alpha",
    ]) ||
    /(?:size[-_/]?(?:fit|chart|guide)|\/size-fit\/|mens?[-_]?tops?[-_]?alpha|mens?_tops?_alpha|tops?[-_]?alpha|apparel[-_/]size|sizecharts?|sizeguides?)/i.test(
      path,
    );
  const incompatibleSignal = containsAny(normalized, [
    ...FOOTWEAR_KEYWORDS,
    ...KIDS_KEYWORDS,
    ...BOTTOMS_KEYWORDS,
    "bra", "bras",
  ]);

  return guideSignal && !incompatibleSignal;
}

function scoreOneHopGuideLink(text: string): {
  score: number;
  reasons: string[];
  rejections: string[];
} {
  const normalized = ` ${normalizeToken(text)} `;
  const reasons: string[] = [];
  const rejections: string[] = [];
  let score = 0;

  if (containsAny(normalized, MEN_KEYWORDS)) {
    score += 3;
    reasons.push("One-hop score +3 for men's context.");
  }
  if (containsAny(normalized, TOPS_KEYWORDS)) {
    score += 3;
    reasons.push("One-hop score +3 for tops/shirts/tees context.");
  }
  if (containsAny(normalized, SIZE_KEYWORDS)) {
    score += 2;
    reasons.push("One-hop score +2 for size context.");
  }
  if (containsAny(normalized, ["chart", "guide", "alpha"])) {
    score += 2;
    reasons.push("One-hop score +2 for chart/guide context.");
  }
  if (containsAny(normalized, FOOTWEAR_KEYWORDS)) {
    score -= 3;
    rejections.push("One-hop score -3 for footwear context.");
  }
  if (containsAny(normalized, BOTTOMS_KEYWORDS)) {
    score -= 3;
    rejections.push("One-hop score -3 for bottoms context.");
  }
  if (containsAny(normalized, KIDS_KEYWORDS)) {
    score -= 5;
    rejections.push("One-hop score -5 for kids/baby context.");
  }

  return { score, reasons, rejections };
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

  // Bonus de base pour tout brand fallback : +5 pour garantir qu'il passe devant
  // les liens génériques faibles, mais reste derrière un bon lien concret.
  let baseScore = 5;

  if (containsAny(normalized, ["underarmour", "under armour"])) {
    if (containsAny(normalized, TOPS_KEYWORDS)) {
      return {
        score: baseScore + 1.5,
        reason: "Under Armour fallback favored an apparel tops link.",
      };
    }
  }

  if (containsAny(normalized, ["newbalance", "new balance"])) {
    if (containsAny(normalized, ["apparel", "clothing", ...TOPS_KEYWORDS])) {
      return {
        score: baseScore + 1.5,
        reason: "New Balance fallback favored apparel over footwear.",
      };
    }
    if (containsAny(normalized, FOOTWEAR_KEYWORDS)) {
      return {
        score: -2,
        reason: "New Balance fallback penalized footwear-only links for apparel requests.",
      };
    }
  }

  if (containsAny(normalized, ["puma", "adidas", "reebok", "nike"])) {
    if (containsAny(normalized, ["apparel", "clothing", ...TOPS_KEYWORDS])) {
      return {
        score: baseScore + 1,
        reason: "Brand fallback favored an apparel-oriented guide link.",
      };
    }
  }

  // Même sans mot-clé spécifique, un brand fallback reste prioritaire
  return {
    score: baseScore,
    reason: "Brand fallback link is preferred over generic links on hub pages.",
  };
}

// ── Création de liens candidats ────────────────────────────────────────

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
  const oneHop = scoreOneHopGuideLink(context);
  const productPage = isProductPageLink(args.url, label);
  const utilityNavigation = isUtilityNavigationLink(label, args.url);
  const badMarketingTarget = isBadMarketingOrUtilityTarget(args.url, label);
  let score = oneHop.score;
  reasons.push(...oneHop.reasons);
  rejectionReasons.push(...oneHop.rejections);

  if (productPage) {
    score -= 20;
    rejectionReasons.push("Link looks like a product page, not a size-guide page.");
  }

  if (utilityNavigation || badMarketingTarget) {
    score -= 20;
    rejectionReasons.push("Link looks like utility navigation, not a size-guide page.");
  }

  if (isSameBrandUrl(args.currentUrl, args.url)) {
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
    reasons.push("Link context supports a top-family match for the requested guide.");
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

  if (args.resolver === "brand-fallback") {
    const fallback = scoreBrandFallbackBonus(args.url, context);
    score += fallback.score;
    if (fallback.reason) {
      if (fallback.score >= 0) {
        reasons.push(fallback.reason);
      } else {
        rejectionReasons.push(fallback.reason);
      }
    }
  }

  if (containsAny(normalizeToken(context), FOOTWEAR_KEYWORDS)) {
    score -= args.requestedCategory === "tshirts" ? 4 : 1;
    rejectionReasons.push("Footwear-focused links are not valid for this apparel request.");
  }

  if (containsAny(normalizeToken(context), BOTTOMS_KEYWORDS)) {
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

// ── Déduplication et découverte ────────────────────────────────────────

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
    if (isUnsupportedFetchTarget(url)) return;

    const anchor = $(node).clone();
    anchor.find("script, style, noscript").remove();
    let label =
      cleanText(anchor.text()) ||
      cleanText($(node).attr("aria-label") ?? "") ||
      cleanText($(node).attr("title") ?? "");
    if (
      label.length > 180 ||
      /\b(?:function|const|let|window|document|fetch|queryselector)\b/i.test(label)
    ) {
      label =
        cleanText($(node).attr("aria-label") ?? "") ||
        cleanText($(node).attr("title") ?? "");
    }
    if (!label) return;
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
      if (match.index > 0 && line[match.index - 1] === "!") continue;
      const url = resolveLink(args.sourceUrl, match[2]);
      if (!url) continue;
      if (isUnsupportedFetchTarget(url)) continue;
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

// ── Fallbacks officiels par marque ──────────────────────────────────────

function officialBrandFallbackUrls(args: {
  sourceUrl: string;
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
  brandFallbackUrls?: string[];
}): Array<{ url: string; label: string }> {
  let host = "";
  try {
    host = new URL(args.sourceUrl).hostname.toLowerCase();
  } catch {
    return [];
  }

  const category = args.requestedCategory;
  const sizeSystem = args.requestedSizeSystem;
  const isTop =
    !category ||
    ["tshirts", "shirts", "hoodies", "jackets"].includes(category);
  const isBottom = category && ["pants", "jeans", "shorts", "leggings"].includes(category);
  const isShoe = category === "shoes" || sizeSystem === "FOOTWEAR";
  const providedFallbacks =
    args.brandFallbackUrls
      ?.map((url, index) => ({
        url: resolveLink(args.sourceUrl, url),
        label: `Fallback guide fourni ${index + 1}`,
      }))
      .filter(
        (fallback): fallback is { url: string; label: string } =>
          Boolean(fallback.url) && !isUnsupportedFetchTarget(fallback.url),
      ) ?? [];

  if (host.includes("nike.com")) {
    if (isShoe) {
      return [...providedFallbacks, { url: "https://www.nike.com/size-fit/mens-footwear", label: "Nike guide officiel chaussures homme" }];
    }
    if (isBottom) {
      return [
        ...providedFallbacks,
        {
          url:
            sizeSystem === "WAIST_INSEAM"
              ? "https://www.nike.com/size-fit/mens-bottoms-numeric/"
              : "https://www.nike.com/size-fit/mens_bottoms_alpha",
          label: "Nike guide officiel bas homme",
        },
      ];
    }
    if (isTop) {
      return [...providedFallbacks, { url: "https://www.nike.com/size-fit/mens-tops-alpha", label: "Nike guide officiel hauts homme" }];
    }
  }

  if (host.includes("adidas.")) {
    if (isShoe) {
      return [...providedFallbacks, { url: "https://www.adidas.com/us/help/size_charts/men-shoes", label: "adidas guide officiel chaussures homme" }];
    }
    if (isBottom) {
      return [...providedFallbacks, { url: "https://www.adidas.com/us/help/size_charts/men-pants_shorts", label: "adidas guide officiel bas homme" }];
    }
    return [...providedFallbacks, { url: "https://www.adidas.com/us/help/size_charts/men-shirts_tops", label: "adidas guide officiel hauts homme" }];
  }

  if (host.includes("puma.")) {
    return [...providedFallbacks, { url: "https://eu.puma.com/de/en/size-charts.html", label: "PUMA guide officiel tailles homme" }];
  }

  if (host.includes("reebok.")) {
    if (isTop) {
      return [...providedFallbacks, { url: "https://www.reebok.com/us/men-tops-size-chart", label: "Reebok guide officiel hauts homme" }];
    }
    return [...providedFallbacks, { url: "https://www.reebok.com/us/size-chart-men", label: "Reebok guide officiel tailles homme" }];
  }

  if (host.includes("underarmour.") || host.includes("under armour.")) {
    if (isTop) {
      return [...providedFallbacks, { url: "https://www.underarmour.com/en-us/t/size-guide/mens-tops/", label: "Under Armour guide officiel hauts homme" }];
    }
    return [...providedFallbacks, { url: "https://www.underarmour.com/en-us/t/size-guide/mens/", label: "Under Armour guide officiel tailles homme" }];
  }

  if (host.includes("newbalance.") || host.includes("new balance.")) {
    return [
      ...providedFallbacks,
      { url: "https://www.newbalance.com/customercare-sizeguide-apparel.html", label: "New Balance guide officiel vêtements homme" },
      { url: "https://www.newbalance.com/sizechart-apparel.html", label: "New Balance ancien guide vêtements homme" },
    ];
  }

  if (host.includes("patagonia.")) {
    return [...providedFallbacks, { url: "https://www.patagonia.com/guides/size-fit/mens/", label: "Patagonia guide officiel tailles homme" }];
  }

  if (host.includes("zara.")) {
    return [...providedFallbacks, { url: "https://www.zara.com/fr/fr/help/size-guide-h38.html", label: "Zara guide officiel tailles" }];
  }

  if (host.includes("tommy.com") || host.includes("tommyhilfiger.")) {
    return [...providedFallbacks, { url: "https://usa.tommy.com/en/size-guide-men.html", label: "Tommy Hilfiger guide officiel tailles homme" }];
  }

  if (host.includes("calvinklein.")) {
    return [...providedFallbacks, { url: "https://www.calvinklein.us/en/men-size-guide.html", label: "Calvin Klein guide officiel tailles homme" }];
  }

  if (host.includes("columbia.")) {
    return [...providedFallbacks, { url: "https://www.columbia.com/sizefit?isPage=true&r=1", label: "Columbia guide officiel hauts homme" }];
  }

  if (host.includes("thenorthface.")) {
    return [...providedFallbacks, { url: "https://www.thenorthface.com/en-us/help/size-charts", label: "The North Face guide officiel hauts homme" }];
  }

  if (host.includes("lacoste.")) {
    return [...providedFallbacks, { url: "https://www.lacoste.com/ca/fr/sizeguide/", label: "Lacoste guide officiel tailles homme" }];
  }

  return providedFallbacks;
}

function discoverBrandFallbackLinks(args: {
  sourceUrl: string;
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
  brandFallbackUrls?: string[];
}): LinkCandidate[] {
  return officialBrandFallbackUrls(args).map((fallback, index) =>
    createLinkCandidate({
      id: makeId("link-brand", index),
      currentUrl: args.sourceUrl,
      url: fallback.url,
      label: fallback.label,
      headingPath: ["Guide officiel connu"],
      nearbyText:
        "Official brand size guide fallback. Guide des tailles officiel. Men's tops size chart. Lien de secours officiel utilisé lorsque la page fournie ne contient pas directement de tableau exploitable.",
      requestedCategory: args.requestedCategory,
      requestedSizeSystem: args.requestedSizeSystem,
      resolver: "brand-fallback",
    }),
  );
}

// ── API publiques ──────────────────────────────────────────────────────

export function discoverLinkCandidates(args: {
  html: string;
  markdown: string;
  sourceUrl: string;
  requestedCategory: GarmentCategory | null;
  requestedSizeSystem: SizeSystem | null;
  brandFallbackUrls?: string[];
}): LinkCandidate[] {
  return dedupeLinks([
    ...discoverHtmlLinks(args),
    ...discoverMarkdownLinks(args),
    ...discoverBrandFallbackLinks(args),
  ]).sort((a, b) => b.score - a.score);
}

export function selectHubFollowLinks(args: {
  linkCandidates: LinkCandidate[];
  requireConcreteGuide?: boolean;
}): {
  linkCandidates: LinkCandidate[];
  selected: LinkCandidate[];
  reasoning: string[];
  navigationConfidence: number;
} {
  const rescored = args.linkCandidates.map((candidate) => {
    const context = [
      candidate.label,
      candidate.headingPath.join(" "),
      candidate.nearbyText,
      candidate.url,
    ].join(" ");
    const primaryContext = [candidate.label, candidate.url].join(" ");
    const isInternal = candidate.reasons.includes("Link stays on the same brand domain.");
    const isNewUrl = !candidate.rejectionReasons.includes(
      "Link resolves to the same URL that was already fetched.",
    );
    const isProductPage = isProductPageLink(candidate.url, candidate.label);
    const isUtilityNavigation = isUtilityNavigationLink(candidate.label, candidate.url);
    const isBadMarketingTarget = isBadMarketingOrUtilityTarget(candidate.url, candidate.label);
    const isUnsupportedTarget = isUnsupportedFetchTarget(candidate.url);
    const hasConcreteGuideSignal = hasConcreteSizeGuideLinkSignal(candidate.url, primaryContext);
    const oneHop = scoreOneHopGuideLink(primaryContext);

    // Un brand fallback est toujours considéré comme ayant un signal concret
    const effectiveConcreteSignal =
      hasConcreteGuideSignal || candidate.resolver === "brand-fallback";

    const disqualifications = [
      ...oneHop.rejections,
      ...(!isInternal ? ["Rejected because one-hop links must stay on the same domain."] : []),
      ...(!isNewUrl ? ["Rejected because one-hop links must not point to the current page."] : []),
      ...(isProductPage ? ["Rejected because the link looks like a product page."] : []),
      ...(isUtilityNavigation || isBadMarketingTarget
        ? ["Rejected because the link looks like utility navigation."]
        : []),
      ...(isUnsupportedTarget
        ? ["Rejected because the link points to an unsupported binary asset."]
        : []),
      ...(args.requireConcreteGuide && !effectiveConcreteSignal
        ? ["Rejected because second-hop links must point to a concrete size guide."]
        : []),
    ];

    const eligible =
      isInternal &&
      isNewUrl &&
      !isProductPage &&
      !isUtilityNavigation &&
      !isBadMarketingTarget &&
      !isUnsupportedTarget &&
      (!args.requireConcreteGuide || effectiveConcreteSignal);

    const baseScore = eligible
      ? oneHop.score + (effectiveConcreteSignal ? 3 : 0)
      : -99;

    // Bonus additionnel pour les brand fallbacks
    const brandBonus = candidate.resolver === "brand-fallback" && eligible ? 4 : 0;

    return {
      ...candidate,
      score: baseScore + brandBonus,
      reasons: oneHop.reasons,
      rejectionReasons: disqualifications,
    };
  });

  const sortedEligible = rescored
    .filter((candidate) => candidate.score >= 3)
    .sort((a, b) => b.score - a.score);

  // Séparation par type
  const concreteGeneric = sortedEligible.filter(
    (candidate) =>
      candidate.resolver === "generic" &&
      hasConcreteSizeGuideLinkSignal(candidate.url, [candidate.label, candidate.url].join(" ")),
  );
  const concreteFallback = sortedEligible.filter(
    (candidate) => candidate.resolver === "brand-fallback",
  );
  // Priorité : lien concret trouvé dans la page > brand-fallback.
  // Le brand-fallback reste là pour les hubs pauvres en liens concrets.
  // Les liens exploratoires de catégories produits ont généré trop de faux positifs
  // (Gift Guide, Style Guide, Styling Book, Denim Fit Guide) et restent en diagnostic.
  const eligiblePool =
    concreteGeneric.length
      ? concreteGeneric
      : concreteFallback;

  const eligible = eligiblePool.slice(0, 1);
  const topRescored = [...rescored].sort((a, b) => b.score - a.score)[0];
  const selectedIds = new Set(eligible.map((candidate) => candidate.id));
  const reasoning: string[] = [];

  if (eligible.length) {
    reasoning.push(
      `Selected ${eligible.length} one-hop internal guide link(s) with score >= 3.`,
    );
    for (const link of eligible) {
      reasoning.push(`One-hop candidate "${link.label}" scored ${link.score}.`);
    }
  } else {
    reasoning.push(
      topRescored
        ? `No one-hop internal guide link reached score >= 3. Best link "${topRescored.label}" scored ${topRescored.score}.`
        : "No one-hop internal guide links were discovered.",
    );
  }

  return {
    linkCandidates: rescored.map((candidate) => ({
      ...candidate,
      selected: selectedIds.has(candidate.id),
    })),
    selected: eligible,
    reasoning,
    navigationConfidence: eligible.length
      ? Math.min(0.98, 0.35 + eligible[0]!.score / 10)
      : 0,
  };
}

// ── Classification de document ─────────────────────────────────────────

function countTableLikeSignals(html: string, markdown: string): number {
  const tableCount =
    (html.match(/<table\b/gi) ?? []).length +
    (html.match(/role=["']table["']/gi) ?? []).length;
  const markdownCount = (markdown.match(/^\|.+\|$/gm) ?? []).length;
  const measurementSignals = (markdown.match(/\b(chest|waist|hips|inseam|foot length)\b/gi) ?? [])
    .length;
  return tableCount + Math.floor(markdownCount / 2) + Math.min(measurementSignals, 4);
}

function countMarkdownTableBlocks(markdown: string): number {
  const lines = markdown.split(/\r?\n/);
  let count = 0;
  for (let index = 0; index < lines.length - 1; index++) {
    const line = lines[index]?.trim() ?? "";
    const next = lines[index + 1]?.trim() ?? "";
    if (line.includes("|") && /^[:|\-\s]+$/.test(next)) {
      count++;
      index += 2;
      while (index < lines.length && (lines[index] ?? "").includes("|")) index++;
    }
  }
  return count;
}

function countStructuredGuideBlocks(html: string, markdown: string): number {
  const $ = cheerio.load(html);
  const htmlTableCount = $("table, [role='table']").length;
  if (htmlTableCount > 0) return htmlTableCount;
  return countMarkdownTableBlocks(markdown);
}

function countDistinctCategorySignals(text: string): number {
  const normalized = normalizeToken(text);
  let count = 0;
  if (containsAny(normalized, TOPS_KEYWORDS)) count++;
  if (containsAny(normalized, BOTTOMS_KEYWORDS)) count++;
  if (containsAny(normalized, FOOTWEAR_KEYWORDS)) count++;
  if (containsAny(normalized, ["bra", "cup size"])) count++;
  if (containsAny(normalized, KIDS_KEYWORDS)) count++;
  return count;
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
  const rawLinkCount = args.linkCandidates.length;
  const tableLikeSignals = countTableLikeSignals(args.html, args.markdown);
  const structuredBlockCount = countStructuredGuideBlocks(args.html, args.markdown);
  const lowerUrl = args.sourceUrl.toLowerCase();
  const text = cleanText(args.markdown || cheerio.load(args.html)("body").text()).slice(0, 20000);
  const categorySignalCount = countDistinctCategorySignals(text);

  if (rawLinkCount >= 6 && structuredBlockCount === 0) {
    reasoning.push("Many internal guide links were found, so this document is a guide hub.");
    return {
      documentKind: "guide-hub-page",
      sourceType: "guide-hub-page",
      reasoning,
    };
  }

  if (structuredBlockCount === 0 && tableLikeSignals === 0 && rawLinkCount >= 2) {
    reasoning.push("Guide-related links were found, but no table-like guide blocks were present.");
    return {
      documentKind: "guide-hub-page",
      sourceType: "guide-hub-page",
      reasoning,
    };
  }

  if (
    structuredBlockCount === 0 &&
    tableLikeSignals === 0 &&
    rawLinkCount === 1 &&
    args.linkCandidates[0]!.score >= 3
  ) {
    reasoning.push("One strong guide-related link was found, but no table-like guide blocks were present.");
    return {
      documentKind: "guide-hub-page",
      sourceType: "guide-hub-page",
      reasoning,
    };
  }

  if (structuredBlockCount > 1 || categorySignalCount >= 2) {
    reasoning.push("Multiple guide/table signals suggest a multi-guide document.");
    return {
      documentKind: "multi-guide-page",
      sourceType: "generic-multi-guide-page",
      reasoning,
    };
  }

  if (structuredBlockCount === 1 || tableLikeSignals > 0) {
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
    documentKind: "irrelevant",
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
