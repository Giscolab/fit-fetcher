import test from "node:test";
import assert from "node:assert/strict";
import { fixtures } from "@/lib/ingestion/__fixtures__/brandSnapshots";
import { discoverCandidateSections } from "@/lib/ingestion/discovery";
import { classifyDocument, discoverLinkCandidates } from "@/lib/ingestion/navigation";
import { runIngestionPipeline } from "@/lib/ingestion/pipeline";
import { selectCandidate } from "@/lib/ingestion/selection";
import { mapRequestedGarmentCategory, mapRequestedSizeSystem } from "@/lib/ingestion/taxonomy";
import { parseRangeCm } from "@/lib/normalizers/units";

function makeSource(brand: string, url: string, garmentCategory = "tshirts", sizeSystem = "INT") {
  return {
    brand,
    size_guide_url: url,
    garmentCategory,
    sizeSystem,
  };
}

async function runFixture(args: {
  brand: string;
  fixture: { url: string; html: string; markdown: string };
  garmentCategory?: string;
  sizeSystem?: string;
  followed?: Record<string, { sourceUrl: string; html: string; markdown: string }>;
}) {
  return runIngestionPipeline({
    source: makeSource(
      args.brand,
      args.fixture.url,
      args.garmentCategory,
      args.sizeSystem,
    ),
    fetchedUrl: args.fixture.url,
    html: args.fixture.html,
    markdown: args.fixture.markdown,
    fetchDocument: args.followed
      ? async (url: string) => {
          const doc = args.followed?.[url];
          assert.ok(doc, `Missing followed fixture for ${url}`);
          return doc;
        }
      : undefined,
  });
}

test("Nike transposed tops table extracts all visible INT rows without collapsing tall variants", async () => {
  const result = await runFixture({
    brand: "Nike",
    fixture: fixtures.nikeDirect,
  });

  assert.ok(result.guide);
  assert.equal(result.report.selectedCandidateId !== undefined, true);
  assert.equal(result.guide.guide.matrixOrientation, "size-columns");
  assert.equal(result.guide.guide.categoryMappingMode, "curated-broad-top");
  assert.deepEqual(result.guide.guide.originalSizeLabels, [
    "XXS",
    "XS",
    "S Tall",
    "M",
    "M Tall",
    "3XL",
    "4XL",
  ]);
  assert.equal(result.guide.shoppingAssistantGuide.guide.garmentCategory, "tshirt");
  assert.equal(result.guide.shoppingAssistantGuide.guide.rows[0]?.dimensions.chestCm?.min, 76);
  assert.equal(result.guide.shoppingAssistantGuide.guide.rows[0]?.dimensions.seatHipsCm?.max, 85);
});

test("Adidas fractional inch ranges are converted without losing the upper bound", () => {
  assert.deepEqual(parseRangeCm('32 1/2–34"', "in"), [82.6, 86.4]);
  assert.deepEqual(parseRangeCm('43–46 1/2"', "in"), [109.2, 118.1]);
});

test("Nike hub filters product links before one-hop ranking", async () => {
  const result = await runFixture({
    brand: "Nike",
    fixture: fixtures.nikeHubWithProductLink,
    followed: fixtures.nikeHubWithProductLink.followed,
  });

  assert.ok(result.guide);
  assert.equal(result.report.followedUrl, "https://www.nike.com/size-fit/mens_tops_alpha");
  assert.deepEqual(
    result.guide.guide.sourceTraceChain.map((step) => step.url),
    [
      "https://www.nike.com/size-fit-guide",
      "https://www.nike.com/gb/w/mens-graphic-tees",
      "https://www.nike.com/size-fit/mens_tops_alpha",
    ],
  );
  const productLink = result.report.linkCandidates.find((link) =>
    link.label.includes("Dri-FIT Legend"),
  );
  assert.equal(productLink?.selected, false);
  assert.ok(
    productLink?.rejectionReasons.some((reason) => reason.includes("product page")),
  );
});

test("Adidas multi-guide page fails instead of extracting from a mixed category page", async () => {
  const result = await runFixture({
    brand: "Adidas",
    fixture: fixtures.adidasMulti,
  });

  assert.equal(result.guide, undefined);
  assert.ok(
    result.report.validationErrors.some(
      (issue) => issue.code === "multiple-categories-detected",
    ),
  );
});

test("Adidas hub follows one-hop tops link before extraction", async () => {
  const result = await runFixture({
    brand: "Adidas",
    fixture: fixtures.adidasHub,
    followed: fixtures.adidasHub.followed,
  });

  assert.ok(result.guide);
  assert.equal(result.report.followedUrl, "https://www.adidas.com/size-chart/men-tops");
  assert.equal(result.guide.guide.sourceSectionTitle, "Men's Shirts & Tops");
  assert.equal(result.guide.guide.garmentCategory, "tshirts");
});

test("Reebok mixed guide page fails until a one-hop tops page is resolved", async () => {
  const result = await runFixture({
    brand: "Reebok",
    fixture: fixtures.reebokMulti,
  });

  assert.equal(result.guide, undefined);
  assert.ok(
    result.report.validationErrors.some(
      (issue) => issue.code === "multiple-categories-detected",
    ),
  );
});

test("Reebok hub follows tops link and preserves extended size breadth through 5XL", async () => {
  const result = await runFixture({
    brand: "Reebok",
    fixture: fixtures.reebokHub,
    followed: fixtures.reebokHub.followed,
  });

  assert.ok(result.guide);
  assert.equal(result.guide.guide.sourceSectionTitle, "Men's Tops Size Guide");
  assert.deepEqual(result.guide.guide.originalSizeLabels.slice(-4), ["2XL", "3XL", "4XL", "5XL"]);
});

test("Under Armour hub follows one internal tops link before extraction", async () => {
  const result = await runFixture({
    brand: "Under Armour",
    fixture: fixtures.underArmourHub,
    followed: fixtures.underArmourHub.followed,
  });

  assert.ok(result.guide);
  assert.equal(result.report.documentKind, "direct-guide-page");
  assert.equal(result.report.followedUrl, "https://www.underarmour.com/en-us/t/size-guide/mens-tops/");
  assert.equal(result.guide.guide.sourceTraceChain.length, 2);
});

test("New Balance hub prefers apparel over footwear for tshirts", async () => {
  const result = await runFixture({
    brand: "New Balance",
    fixture: fixtures.newBalanceHub,
    followed: fixtures.newBalanceHub.followed,
  });

  assert.ok(result.guide);
  assert.equal(result.report.followedUrl, "https://www.newbalance.com/size-guide/apparel/");
  assert.equal(result.guide.guide.garmentCategory, "tshirts");
});

test("Puma footwear-only page fails safely instead of generating a fake tops guide", async () => {
  const result = await runFixture({
    brand: "Puma",
    fixture: fixtures.pumaFootwearOnly,
  });

  assert.equal(result.guide, undefined);
  assert.equal(result.report.manualReviewRecommended, true);
  assert.ok(
    result.report.selectionReasoning.join(" ").includes("does not match") ||
      result.report.validationErrors.some((issue) => issue.code === "no-unique-section-match"),
  );
});

test("Mixed chest and inseam evidence is rejected instead of becoming a tshirts guide", async () => {
  const result = await runFixture({
    brand: "Invalid Tops",
    fixture: fixtures.invalidTopWithInseam,
  });

  assert.equal(result.guide, undefined);
  assert.ok(
    result.report.validationErrors.some((issue) => issue.code === "no-unique-section-match") ||
      result.report.selectionReasoning.join(" ").includes("Generic body guidance"),
  );
});

test("Bottoms guide containing chest is rejected semantically", async () => {
  const result = await runFixture({
    brand: "Invalid Pants",
    fixture: fixtures.invalidBottomWithChest,
    garmentCategory: "pants",
  });

  assert.equal(result.guide, undefined);
  assert.ok(result.report.validationErrors.some((issue) => issue.code === "bottom-has-chest"));
});

test("Mixed body guidance is classified as generic-body-guide and not coerced into tshirts", () => {
  const sourceUrl = fixtures.mixedBodyGuide.url;
  const requestedCategory = mapRequestedGarmentCategory("tshirts");
  const requestedSizeSystem = mapRequestedSizeSystem("INT");
  const links = discoverLinkCandidates({
    html: fixtures.mixedBodyGuide.html,
    markdown: fixtures.mixedBodyGuide.markdown,
    sourceUrl,
    requestedCategory,
    requestedSizeSystem,
  });
  const classified = classifyDocument({
    html: fixtures.mixedBodyGuide.html,
    markdown: fixtures.mixedBodyGuide.markdown,
    sourceUrl,
    linkCandidates: links,
  });
  const candidates = discoverCandidateSections({
    html: fixtures.mixedBodyGuide.html,
    markdown: fixtures.mixedBodyGuide.markdown,
    sourceUrl,
    sourceType: classified.sourceType,
    documentKind: classified.documentKind,
    sourceTraceChain: [
      {
        kind: "requested-url",
        url: sourceUrl,
        label: "Mixed body guide",
        confidence: 1,
        reasons: ["fixture"],
      },
    ],
  });
  const selection = selectCandidate({
    requestedCategory,
    requestedSizeSystem,
    candidates,
  });

  assert.equal(candidates[0]?.detectedCategory, "generic-body-guide");
  assert.equal(selection.selectedCandidateId, undefined);
});

test("Material size breadth loss is rejected", async () => {
  const result = await runFixture({
    brand: "Breadth Loss",
    fixture: fixtures.breadthLoss,
  });

  assert.equal(result.guide, undefined);
  assert.ok(
    result.report.validationErrors.some((issue) =>
      ["size-breadth-loss", "no-unique-section-match"].includes(issue.code),
    ),
  );
});

test("Advisory-only pages stay in review instead of becoming guides", async () => {
  const result = await runFixture({
    brand: "Advisory",
    fixture: fixtures.advisoryOnly,
  });

  assert.equal(result.guide, undefined);
  assert.equal(result.report.discoveredCandidates[0]?.kind, "advisory-text");
  assert.equal(result.report.manualReviewRecommended, true);
});
