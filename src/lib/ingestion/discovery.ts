import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { detectFields, detectMeasurementUnit, fieldFromHeader } from "@/lib/ingestion/measurements";
import {
  containsAny,
  detectAudience,
  detectCategory,
  detectCategoryMapping,
  detectFitVariant,
  detectSizeSystem,
  isSizeLikeLabel,
  normalizeToken,
} from "@/lib/ingestion/taxonomy";
import type {
  CandidateKind,
  CandidateSection,
  DocumentKind,
  MatrixOrientation,
  SourceTraceStep,
  SourceType,
} from "@/lib/types";

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function makeId(index: number): string {
  return `candidate-${index + 1}`;
}

function normalizeRow(row: string[], width: number): string[] {
  const next = [...row];
  while (next.length < width) next.push("");
  return next.slice(0, width);
}

function normalizeMatrix(matrix: string[][]): string[][] {
  const filtered = matrix
    .map((row) => row.map((cell) => cleanText(cell)))
    .filter((row) => row.some(Boolean));
  if (!filtered.length) return [];
  const width = Math.max(...filtered.map((row) => row.length));
  return filtered.map((row) => normalizeRow(row, width));
}

function isExplicitSystemLabel(label: string): boolean {
  return /\b(us|uk|eu|fr|it|int|international)\b/i.test(label);
}

function inferMatrixOrientation(matrix: string[][]): {
  matrixOrientation: MatrixOrientation;
  rawHeaders: string[];
  rawStubColumn: string[];
  rawSizeAxisLabels: string[];
  visibleColumnLabels: string[];
  visibleRowLabels: string[];
} {
  const normalized = normalizeMatrix(matrix);
  const rawHeaders = normalized[0] ?? [];
  const bodyRows = normalized.slice(1);
  const rawStubColumn = bodyRows.map((row) => row[0] ?? "").filter(Boolean);
  const headerSizeLabels = rawHeaders.slice(1).filter(isSizeLikeLabel);
  const stubSizeLabels = rawStubColumn.filter(isSizeLikeLabel);
  const headerSystemLabels = rawHeaders.filter(isExplicitSystemLabel);
  const stubSystemLabels = rawStubColumn.filter(isExplicitSystemLabel);
  const stubFieldCount = rawStubColumn.filter((cell) => Boolean(fieldFromHeader(cell))).length;
  const headerFieldCount = rawHeaders.filter((cell) => Boolean(fieldFromHeader(cell))).length;

  let matrixOrientation: MatrixOrientation = "unknown";
  let rawSizeAxisLabels: string[] = [];

  if (
    headerSystemLabels.length >= 2 ||
    stubSystemLabels.length >= 2 ||
    (headerSizeLabels.length >= 2 && stubSizeLabels.length >= 2)
  ) {
    matrixOrientation = "conversion-grid";
    rawSizeAxisLabels = stubSizeLabels.length >= headerSizeLabels.length ? stubSizeLabels : headerSizeLabels;
  } else if (stubSizeLabels.length >= 2 && (headerFieldCount > 0 || headerSizeLabels.length === 0)) {
    matrixOrientation = "size-rows";
    rawSizeAxisLabels = stubSizeLabels;
  } else if (headerSizeLabels.length >= 2 && (stubFieldCount > 0 || stubSizeLabels.length === 0)) {
    matrixOrientation = "size-columns";
    rawSizeAxisLabels = headerSizeLabels;
  } else if (headerSizeLabels.length >= 2) {
    matrixOrientation = "size-columns";
    rawSizeAxisLabels = headerSizeLabels;
  } else if (stubSizeLabels.length >= 2) {
    matrixOrientation = "size-rows";
    rawSizeAxisLabels = stubSizeLabels;
  }

  return {
    matrixOrientation,
    rawHeaders,
    rawStubColumn,
    rawSizeAxisLabels,
    visibleColumnLabels: rawHeaders,
    visibleRowLabels: rawSizeAxisLabels,
  };
}

function extractHtmlTableMatrix(
  $: cheerio.CheerioAPI,
  table: Element,
): string[][] {
  return normalizeMatrix(
    $(table)
      .find("tr")
      .toArray()
      .map((row) =>
        $(row)
          .find("th, td")
          .toArray()
          .map((cell) => cleanText($(cell).text())),
      ),
  );
}

function extractAriaGridMatrix(
  $: cheerio.CheerioAPI,
  grid: Element,
): string[][] {
  return normalizeMatrix(
    $(grid)
      .find('[role="row"]')
      .toArray()
      .map((row) =>
        $(row)
          .find('[role="cell"], [role="columnheader"], [role="rowheader"]')
          .toArray()
          .map((cell) => cleanText($(cell).text())),
      ),
  );
}

function splitLooseRow(text: string): string[] {
  const raw = text.trim();
  const compact = cleanText(text);
  if (!compact) return [];
  if (raw.includes("\t")) {
    return raw.split(/\t+/).map((cell) => cleanText(cell)).filter(Boolean);
  }
  const byLargeWhitespace = raw.split(/\s{2,}/).map((cell) => cleanText(cell)).filter(Boolean);
  if (byLargeWhitespace.length >= 2) return byLargeWhitespace;
  return [];
}

function extractDivGridMatrix(
  $: cheerio.CheerioAPI,
  container: Element,
): string[][] {
  const rows: string[][] = [];
  const children = $(container)
    .children()
    .filter((_, node) => !$(node).is("script, style, noscript"))
    .toArray()
    .slice(0, 20);

  for (const child of children) {
    const directChildren = $(child)
      .children()
      .filter((_, node) => !$(node).is("script, style, noscript"))
      .toArray();

    let row: string[] = [];
    if (directChildren.length >= 2) {
      row = directChildren
        .map((node) => cleanText($(node).text()))
        .filter(Boolean)
        .slice(0, 12);
    } else {
      row = splitLooseRow($(child).text());
    }

    if (row.length >= 2) {
      rows.push(row);
    }
  }

  const normalized = normalizeMatrix(rows);
  const width = normalized[0]?.length ?? 0;
  if (normalized.length < 2 || width < 2) return [];

  const irregularRows = normalized.filter((row) => row.filter(Boolean).length < 2).length;
  if (irregularRows > Math.floor(normalized.length / 3)) return [];

  return normalized;
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

function collectSubheading(
  $: cheerio.CheerioAPI,
  element: Element,
): string | undefined {
  const parent = $(element).parent();
  const sibling = parent
    .children("p, strong, span, div")
    .toArray()
    .map((node) => cleanText($(node).text()))
    .find((text) => text.length > 0 && text.length <= 140);
  return sibling || undefined;
}

function collectNearbyText(
  $: cheerio.CheerioAPI,
  element: Element,
): string {
  const chunks: string[] = [];
  let previous = $(element).prev();
  while (previous.length && chunks.join(" ").length < 260) {
    if (previous.is("h1, h2, h3, h4, h5, h6, table, [role='table']")) break;
    const text = cleanText(previous.text());
    if (text) chunks.unshift(text);
    previous = previous.prev();
  }

  let next = $(element).next();
  while (next.length && chunks.join(" ").length < 420) {
    if (next.is("h1, h2, h3, h4, h5, h6, table, [role='table']")) break;
    const text = cleanText(next.text());
    if (text) chunks.push(text);
    next = next.next();
  }

  return chunks.join(" ").slice(0, 420);
}

function createCandidate(args: {
  id: string;
  kind: CandidateKind;
  sourceUrl: string;
  sourceType: SourceType;
  documentKind: DocumentKind;
  sourceTraceChain: SourceTraceStep[];
  linkOriginId?: string;
  navigationConfidence: number;
  matrix: string[][];
  headingPath: string[];
  sectionTitle: string;
  subheading?: string;
  nearbyAdvisoryText: string;
}): CandidateSection {
  const matrix = normalizeMatrix(args.matrix);
  const matrixMeta = inferMatrixOrientation(matrix);
  const combinedLabels = [
    ...matrixMeta.rawHeaders,
    ...matrixMeta.rawStubColumn,
    ...matrixMeta.rawSizeAxisLabels,
  ];
  const fields = detectFields(combinedLabels);
  const contextText = [
    args.sectionTitle,
    args.subheading ?? "",
    args.headingPath.join(" "),
    args.nearbyAdvisoryText,
    ...matrixMeta.rawHeaders,
    ...matrixMeta.rawStubColumn,
  ].join(" ");
  const category = detectCategory({
    sectionTitle: args.sectionTitle,
    subheading: args.subheading,
    headers: matrixMeta.rawHeaders,
    rowLabels: matrixMeta.rawSizeAxisLabels,
    stubColumn: matrixMeta.rawStubColumn,
    nearbyText: args.nearbyAdvisoryText,
    fields,
  });
  const categoryMapping = detectCategoryMapping({
    detectedCategory: category.detectedCategory,
    detectedCategoryLabel: category.detectedCategoryLabel,
    sectionTitle: args.sectionTitle,
    subheading: args.subheading,
    nearbyText: args.nearbyAdvisoryText,
    fields,
  });
  const extractionConfidence = Math.max(
    0.08,
    Math.min(
      0.99,
      0.16 +
        (fields.length > 0 ? 0.2 : 0) +
        Math.min(matrixMeta.rawSizeAxisLabels.length, 10) * 0.05 +
        (args.kind === "advisory-text" ? -0.2 : 0) +
        (matrixMeta.matrixOrientation !== "unknown" ? 0.18 : 0) +
        (category.detectedCategory !== "unknown" ? 0.12 : 0) +
        (args.navigationConfidence ? Math.min(0.1, args.navigationConfidence / 4) : 0),
    ),
  );

  const evidenceSnippet = [
    args.sectionTitle,
    args.subheading,
    matrixMeta.rawHeaders.length ? `Headers: ${matrixMeta.rawHeaders.join(", ")}` : "",
    matrixMeta.rawStubColumn.length ? `Stub: ${matrixMeta.rawStubColumn.slice(0, 8).join(", ")}` : "",
    matrixMeta.rawSizeAxisLabels.length
      ? `Sizes: ${matrixMeta.rawSizeAxisLabels.slice(0, 12).join(", ")}`
      : "",
    args.nearbyAdvisoryText,
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 600);

  return {
    id: args.id,
    kind: args.kind,
    isTabular: args.kind !== "advisory-text",
    sourceUrl: args.sourceUrl,
    sourceType:
      category.detectedCategory === "generic-body-guide"
        ? "generic-body-guide"
        : args.sourceType,
    documentKind: args.documentKind,
    sourceTraceChain: args.sourceTraceChain,
    linkOriginId: args.linkOriginId,
    navigationConfidence: args.navigationConfidence,
    sectionTitle: args.sectionTitle || "Untitled section",
    subheading: args.subheading,
    headingPath: args.headingPath,
    audience: detectAudience(contextText),
    garmentFamily: category.garmentFamily,
    detectedCategory: category.detectedCategory,
    detectedCategoryLabel: category.detectedCategoryLabel,
    fitVariant: detectFitVariant(contextText),
    detectedSizeSystem: detectSizeSystem({
      rowLabels: matrixMeta.rawSizeAxisLabels,
      headers: matrixMeta.rawHeaders,
      stubColumn: matrixMeta.rawStubColumn,
      sizeAxisLabels: matrixMeta.rawSizeAxisLabels,
      context: contextText,
    }),
    originalUnitSystem: detectMeasurementUnit(`${contextText} ${matrix.flat().join(" ")}`),
    matrixOrientation: matrixMeta.matrixOrientation,
    categoryMappingMode: categoryMapping.mode,
    categoryMappingReason: categoryMapping.reason,
    rawHeaders: matrixMeta.rawHeaders,
    rawStubColumn: matrixMeta.rawStubColumn,
    rawSizeAxisLabels: matrixMeta.rawSizeAxisLabels,
    visibleColumnLabels: matrixMeta.visibleColumnLabels,
    visibleRowLabels: matrixMeta.visibleRowLabels,
    nearbyAdvisoryText: args.nearbyAdvisoryText,
    rawEvidenceSnippet: evidenceSnippet,
    matrix,
    extractionConfidence,
    selectionScore: 0,
    matchReasons: [
      ...category.reasons,
      ...(categoryMapping.reason ? [categoryMapping.reason] : []),
    ],
    rejectionReasons: [],
    warnings:
      args.kind === "advisory-text"
        ? ["Advisory text was detected without a nearby structured table."]
        : matrixMeta.matrixOrientation === "unknown"
          ? ["Matrix orientation could not be resolved confidently."]
          : [],
  };
}

function parseMarkdownRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, "");
  return trimmed.split("|").map((cell) => cleanText(cell));
}

function isMarkdownSeparator(line: string): boolean {
  return /^[:|\-\s]+$/.test(line.trim());
}

function discoverMarkdownTables(args: {
  markdown: string;
  sourceUrl: string;
  sourceType: SourceType;
  documentKind: DocumentKind;
  sourceTraceChain: SourceTraceStep[];
  linkOriginId?: string;
  navigationConfidence: number;
  indexOffset: number;
}): CandidateSection[] {
  const lines = args.markdown.split(/\r?\n/);
  const candidates: CandidateSection[] = [];
  let headingPath: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      headingPath = [...headingPath.slice(-2), cleanText(headingMatch[2])];
      continue;
    }

    if (!line.includes("|")) continue;
    const separator = lines[i + 1]?.trim() ?? "";
    if (!isMarkdownSeparator(separator)) continue;

    const matrix: string[][] = [parseMarkdownRow(line)];
    let j = i + 2;
    while (j < lines.length && lines[j].includes("|")) {
      const row = parseMarkdownRow(lines[j]);
      if (!row.some(Boolean)) break;
      matrix.push(row);
      j++;
    }

    if (matrix.length < 2) continue;

    const sectionTitle = headingPath[headingPath.length - 1] ?? "Markdown table";
    const nearbyText = cleanText((lines[i - 1] ?? "") + " " + (lines[j] ?? ""));

    candidates.push(
      createCandidate({
        id: makeId(args.indexOffset + candidates.length),
        kind: "markdown-table",
        sourceUrl: args.sourceUrl,
        sourceType: args.sourceType,
        documentKind: args.documentKind,
        sourceTraceChain: args.sourceTraceChain,
        linkOriginId: args.linkOriginId,
        navigationConfidence: args.navigationConfidence,
        matrix,
        headingPath,
        sectionTitle,
        nearbyAdvisoryText: nearbyText,
      }),
    );
    i = j;
  }

  return candidates;
}

function discoverDelimitedMarkdownGrids(args: {
  markdown: string;
  sourceUrl: string;
  sourceType: SourceType;
  documentKind: DocumentKind;
  sourceTraceChain: SourceTraceStep[];
  linkOriginId?: string;
  navigationConfidence: number;
  indexOffset: number;
}): CandidateSection[] {
  const lines = args.markdown.split(/\r?\n/);
  const candidates: CandidateSection[] = [];
  let headingPath: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      headingPath = [...headingPath.slice(-2), cleanText(headingMatch[2])];
      continue;
    }

    const parsed = splitLooseRow(lines[i] ?? "");
    if (parsed.length < 2) continue;

    const matrix = [parsed];
    let j = i + 1;
    while (j < lines.length) {
      const row = splitLooseRow(lines[j] ?? "");
      if (row.length < 2) break;
      matrix.push(row);
      j++;
    }

    const normalized = normalizeMatrix(matrix);
    const flat = normalized.flat().map((cell) => normalizeToken(cell));
    const signalCount =
      flat.filter((cell) => isSizeLikeLabel(cell) || Boolean(fieldFromHeader(cell))).length;
    if (normalized.length < 2 || signalCount < 3) continue;

    const sectionTitle = headingPath[headingPath.length - 1] ?? "Markdown grid";
    candidates.push(
      createCandidate({
        id: makeId(args.indexOffset + candidates.length),
        kind: "markdown-grid",
        sourceUrl: args.sourceUrl,
        sourceType: args.sourceType,
        documentKind: args.documentKind,
        sourceTraceChain: args.sourceTraceChain,
        linkOriginId: args.linkOriginId,
        navigationConfidence: args.navigationConfidence,
        matrix: normalized,
        headingPath,
        sectionTitle,
        nearbyAdvisoryText: cleanText(
          `${lines[i - 1] ?? ""} ${lines[j] ?? ""}`.slice(0, 300),
        ),
      }),
    );

    i = j;
  }

  return candidates;
}

function discoverDivGrids(args: {
  html: string;
  sourceUrl: string;
  sourceType: SourceType;
  documentKind: DocumentKind;
  sourceTraceChain: SourceTraceStep[];
  linkOriginId?: string;
  navigationConfidence: number;
  indexOffset: number;
}): CandidateSection[] {
  const $ = cheerio.load(args.html);
  const candidates: CandidateSection[] = [];

  $("section, article, div").each((_, node) => {
    if (candidates.length >= 18) return false;
    const element = $(node);
    if (element.find("table, [role='table']").length > 0) return;
    const childCount = element.children().length;
    if (childCount < 2 || childCount > 20) return;

    const text = cleanText(element.text());
    const normalized = normalizeToken(text);
    if (
      !containsAny(normalized, [
        "size",
        "fit",
        "guide",
        "chart",
        "chest",
        "waist",
        "hips",
        "inseam",
        "xxs",
        "xs",
        "xl",
      ])
    ) {
      return;
    }

    const matrix = extractDivGridMatrix($, node);
    if (matrix.length < 2) return;

    const flat = matrix.flat();
    const signalCount = flat.filter(
      (cell) => isSizeLikeLabel(cell) || Boolean(fieldFromHeader(cell)),
    ).length;
    if (signalCount < 3) return;

    const headingPath = collectHeadingPath($, node);
    const sectionTitle =
      headingPath.slice(-1)[0] || cleanText(element.attr("aria-label") ?? "") || "Grid section";

    candidates.push(
      createCandidate({
        id: makeId(args.indexOffset + candidates.length),
        kind: "div-grid",
        sourceUrl: args.sourceUrl,
        sourceType: args.sourceType,
        documentKind: args.documentKind,
        sourceTraceChain: args.sourceTraceChain,
        linkOriginId: args.linkOriginId,
        navigationConfidence: args.navigationConfidence,
        matrix,
        headingPath,
        sectionTitle,
        subheading: collectSubheading($, node),
        nearbyAdvisoryText: collectNearbyText($, node),
      }),
    );
  });

  return candidates;
}

function discoverAdvisorySections(args: {
  html: string;
  sourceUrl: string;
  sourceType: SourceType;
  documentKind: DocumentKind;
  sourceTraceChain: SourceTraceStep[];
  linkOriginId?: string;
  navigationConfidence: number;
  indexOffset: number;
}): CandidateSection[] {
  const $ = cheerio.load(args.html);
  const candidates: CandidateSection[] = [];

  $("h1, h2, h3, h4").each((_, node) => {
    const title = cleanText($(node).text());
    if (!/(size|taille|fit|measure|guide)/i.test(title)) return;

    const siblings = $(node).nextAll().slice(0, 4);
    const hasStructuredTable =
      siblings.filter("table, [role='table']").length > 0 ||
      siblings.find("table, [role='table']").length > 0;
    if (hasStructuredTable) return;

    const nearby = cleanText(siblings.text());
    if (!nearby) return;

    candidates.push(
      createCandidate({
        id: makeId(args.indexOffset + candidates.length),
        kind: "advisory-text",
        sourceUrl: args.sourceUrl,
        sourceType: args.sourceType,
        documentKind: args.documentKind,
        sourceTraceChain: args.sourceTraceChain,
        linkOriginId: args.linkOriginId,
        navigationConfidence: args.navigationConfidence,
        matrix: [[title], [nearby]],
        headingPath: [title],
        sectionTitle: title,
        nearbyAdvisoryText: nearby,
      }),
    );
  });

  return candidates;
}

function dedupeCandidates(candidates: CandidateSection[]): CandidateSection[] {
  const bySignature = new Map<string, CandidateSection>();

  for (const candidate of candidates) {
    const signature = [
      candidate.sectionTitle,
      candidate.matrixOrientation,
      candidate.rawHeaders.join("||"),
      candidate.rawStubColumn.join("||"),
      candidate.rawSizeAxisLabels.join("||"),
    ].join("::");

    const existing = bySignature.get(signature);
    if (!existing || existing.extractionConfidence < candidate.extractionConfidence) {
      bySignature.set(signature, candidate);
    }
  }

  return Array.from(bySignature.values()).map((candidate, index) => ({
    ...candidate,
    id: makeId(index),
  }));
}

export function discoverCandidateSections(args: {
  html: string;
  markdown: string;
  sourceUrl: string;
  sourceType: SourceType;
  documentKind: DocumentKind;
  sourceTraceChain: SourceTraceStep[];
  linkOriginId?: string;
  navigationConfidence?: number;
}): CandidateSection[] {
  const $ = cheerio.load(args.html);
  const navigationConfidence = args.navigationConfidence ?? 0;
  const htmlTables = $("table").toArray();
  const ariaTables = $('[role="table"]').toArray();

  const htmlCandidates = htmlTables.map((table, index) => {
    const headingPath = collectHeadingPath($, table);
    const sectionTitle =
      headingPath.slice(-1)[0] || cleanText($(table).attr("aria-label") ?? "") || "HTML table";

    return createCandidate({
      id: makeId(index),
      kind: "html-table",
      sourceUrl: args.sourceUrl,
      sourceType: args.sourceType,
      documentKind: args.documentKind,
      sourceTraceChain: args.sourceTraceChain,
      linkOriginId: args.linkOriginId,
      navigationConfidence,
      matrix: extractHtmlTableMatrix($, table),
      headingPath,
      sectionTitle,
      subheading: collectSubheading($, table),
      nearbyAdvisoryText: collectNearbyText($, table),
    });
  });

  const ariaCandidates = ariaTables.map((table, index) => {
    const headingPath = collectHeadingPath($, table);
    const sectionTitle =
      headingPath.slice(-1)[0] || cleanText($(table).attr("aria-label") ?? "") || "ARIA table";

    return createCandidate({
      id: makeId(htmlCandidates.length + index),
      kind: "aria-grid",
      sourceUrl: args.sourceUrl,
      sourceType: args.sourceType,
      documentKind: args.documentKind,
      sourceTraceChain: args.sourceTraceChain,
      linkOriginId: args.linkOriginId,
      navigationConfidence,
      matrix: extractAriaGridMatrix($, table),
      headingPath,
      sectionTitle,
      subheading: collectSubheading($, table),
      nearbyAdvisoryText: collectNearbyText($, table),
    });
  });

  const markdownCandidates = discoverMarkdownTables({
    markdown: args.markdown,
    sourceUrl: args.sourceUrl,
    sourceType: args.sourceType,
    documentKind: args.documentKind,
    sourceTraceChain: args.sourceTraceChain,
    linkOriginId: args.linkOriginId,
    navigationConfidence,
    indexOffset: htmlCandidates.length + ariaCandidates.length,
  });

  const markdownGridCandidates = discoverDelimitedMarkdownGrids({
    markdown: args.markdown,
    sourceUrl: args.sourceUrl,
    sourceType: args.sourceType,
    documentKind: args.documentKind,
    sourceTraceChain: args.sourceTraceChain,
    linkOriginId: args.linkOriginId,
    navigationConfidence,
    indexOffset: htmlCandidates.length + ariaCandidates.length + markdownCandidates.length,
  });

  const divGridCandidates = discoverDivGrids({
    html: args.html,
    sourceUrl: args.sourceUrl,
    sourceType: args.sourceType,
    documentKind: args.documentKind,
    sourceTraceChain: args.sourceTraceChain,
    linkOriginId: args.linkOriginId,
    navigationConfidence,
    indexOffset:
      htmlCandidates.length +
      ariaCandidates.length +
      markdownCandidates.length +
      markdownGridCandidates.length,
  });

  const advisoryCandidates = discoverAdvisorySections({
    html: args.html,
    sourceUrl: args.sourceUrl,
    sourceType: args.sourceType,
    documentKind: args.documentKind,
    sourceTraceChain: args.sourceTraceChain,
    linkOriginId: args.linkOriginId,
    navigationConfidence,
    indexOffset:
      htmlCandidates.length +
      ariaCandidates.length +
      markdownCandidates.length +
      markdownGridCandidates.length +
      divGridCandidates.length,
  });

  return dedupeCandidates(
    [
      ...htmlCandidates,
      ...ariaCandidates,
      ...markdownCandidates,
      ...markdownGridCandidates,
      ...divGridCandidates,
      ...advisoryCandidates,
    ].filter(
      (candidate) =>
        candidate.matrix.length >= 2 &&
        candidate.matrix.some((row) => row.some(Boolean)),
    ),
  );
}
