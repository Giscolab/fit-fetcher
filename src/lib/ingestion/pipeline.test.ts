import test from "node:test";
import assert from "node:assert/strict";
import { fixtures } from "@/lib/ingestion/__fixtures__/brandSnapshots";
import { discoverCandidateSections } from "@/lib/ingestion/discovery";
import {
  classifyDocument,
  discoverLinkCandidates,
  selectHubFollowLinks,
} from "@/lib/ingestion/navigation";
import { runIngestionPipeline } from "@/lib/ingestion/pipeline";
import { selectCandidate } from "@/lib/ingestion/selection";
import { mapRequestedGarmentCategory, mapRequestedSizeSystem } from "@/lib/ingestion/taxonomy";
import { parseRangeCm } from "@/lib/normalizers/units";
import type { SizeRow } from "@/lib/types";

function makeSource(
  brand: string,
  url: string,
  garmentCategory = "tshirts",
  sizeSystem = "INT",
  fallbackSizeSystem?: string,
) {
  return {
    brand,
    size_guide_url: url,
    garmentCategory,
    sizeSystem,
    fallbackSizeSystem,
  };
}

async function runFixture(args: {
  brand: string;
  fixture: { url: string; html: string; markdown: string };
  garmentCategory?: string;
  sizeSystem?: string;
  fallbackSizeSystem?: string;
  followed?: Record<string, { sourceUrl: string; html: string; markdown: string }>;
  fetchDocument?: Parameters<typeof runIngestionPipeline>[0]["fetchDocument"];
  llmExtractCandidate?: Parameters<typeof runIngestionPipeline>[0]["llmExtractCandidate"];
}) {
  return runIngestionPipeline({
    source: makeSource(
      args.brand,
      args.fixture.url,
      args.garmentCategory,
      args.sizeSystem,
      args.fallbackSizeSystem,
    ),
    fetchedUrl: args.fixture.url,
    html: args.fixture.html,
    markdown: args.fixture.markdown,
    fetchDocument:
      args.fetchDocument ??
      (args.followed
        ? async (url: string) => {
            const doc = args.followed?.[url];
            assert.ok(doc, `Missing followed fixture for ${url}`);
            return doc;
          }
        : undefined),
    llmExtractCandidate: args.llmExtractCandidate,
  });
}

function llmTopRows(includeInseam = false): SizeRow[] {
  return ["XS", "S", "M", "L", "XL"].map((label, index) => ({
    label,
    originalLabel: label,
    canonicalLabel: label,
    fitVariant: "standard",
    evidenceRowLabel: label,
    rawMeasurements: {},
    chestCmMin: 80 + index * 6,
    chestCmMax: 86 + index * 6,
    ...(includeInseam
      ? {
          inseamCmMin: 76 + index,
          inseamCmMax: 78 + index,
        }
      : {}),
  }));
}

const llmOnlyTopFixture = {
  url: "https://example.com/llm-only-tops",
  html: `
    <html>
      <body>
        <h1>Men's Tops Size Guide</h1>
        <table>
          <tr><th>Size</th><th>Chest (cm)</th><th>Height (cm)</th></tr>
          <tr><td>XS</td><td>See rendered chart</td><td>See rendered chart</td></tr>
          <tr><td>S</td><td>See rendered chart</td><td>See rendered chart</td></tr>
          <tr><td>M</td><td>See rendered chart</td><td>See rendered chart</td></tr>
          <tr><td>L</td><td>See rendered chart</td><td>See rendered chart</td></tr>
          <tr><td>XL</td><td>See rendered chart</td><td>See rendered chart</td></tr>
        </table>
      </body>
    </html>
  `,
  markdown: `
# Men's Tops Size Guide

Size | Chest (cm) | Height (cm)
--- | --- | ---
XS | See rendered chart | See rendered chart
S | See rendered chart | See rendered chart
M | See rendered chart | See rendered chart
L | See rendered chart | See rendered chart
XL | See rendered chart | See rendered chart
  `,
};

const renderedTopGuide = {
  sourceUrl: "https://www.nike.com/size-fit/mens-tops-alpha",
  html: `
    <html>
      <body>
        <h1>Men's Tops Size Guide</h1>
        <table>
          <tr><th>Size</th><th>Chest (cm)</th><th>Waist (cm)</th><th>Hips (cm)</th></tr>
          <tr><td>XS</td><td>80-86</td><td>66-71</td><td>81-86</td></tr>
          <tr><td>S</td><td>86-92</td><td>71-76</td><td>86-91</td></tr>
          <tr><td>M</td><td>92-98</td><td>76-81</td><td>91-96</td></tr>
          <tr><td>L</td><td>98-104</td><td>81-86</td><td>96-101</td></tr>
          <tr><td>XL</td><td>104-110</td><td>86-91</td><td>101-106</td></tr>
        </table>
      </body>
    </html>
  `,
  markdown: `
# Men's Tops Size Guide

Size | Chest (cm) | Waist (cm) | Hips (cm)
--- | --- | --- | ---
XS | 80-86 | 66-71 | 81-86
S | 86-92 | 71-76 | 86-91
M | 92-98 | 76-81 | 91-96
L | 98-104 | 81-86 | 96-101
XL | 104-110 | 86-91 | 101-106
  `,
};

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

test("Nike table keeps inch units even when nearby fit tips mention centimeters", async () => {
  const result = await runFixture({
    brand: "Nike",
    fixture: fixtures.nikeInchesWithMetricFitTips,
  });

  assert.ok(result.guide);
  assert.equal(result.guide.guide.originalUnitSystem, "in");
  assert.equal(result.guide.guide.sourceType, "category-specific-page");
  assert.equal(result.guide.shoppingAssistantGuide.guide.rows[0]?.dimensions.chestCm?.min, 80);
});

test("Nike Firecrawl markdown table without separator extracts the rendered tops guide", async () => {
  const result = await runFixture({
    brand: "Nike",
    fixture: {
      url: "https://www.nike.com/size-fit/mens_tops_alpha",
      html: "",
      markdown: `
Nike
[Find a Store](https://www.nike.com/retail)
[Help](https://www.nike.com/help)
[Shoes](https://www.nike.com/w/mens-shoes-nik1zy7ok)
[Tops](https://www.nike.com/w/mens-tops-t-shirts-9om13znik1)

# Men's Tops
The measurements on the size chart are body measurements.

Size Chart

incminToggle between inches and centimeters

| Size | XXS | XS | S | S Tall | M | M Tall | L | L Tall | XL | XL Tall | XXL | XXL Tall | 3XL | 3XL Tall | 4XL | 4XL Tall |
| Chest (in) | 28.1 - 31.5 | 31.5 - 35 | 35 - 37.5 | 35 - 37.5 | 37.5 - 41 | 37.5 - 41 | 41 - 44 | 41 - 44 | 44 - 48.5 | 44 - 48.5 | 48.5 - 53.5 | 48.5 - 53.5 | 53.5 - 58 | 53.5 - 58 | 58 - 63 | 58 - 63 |
| Waist (in) | 22.5 - 25.5 | 25.5 - 29 | 29 - 32 | 29 - 32 | 32 - 35 | 32 - 35 | 35 - 38 | 35 - 38 | 38 - 43 | 38 - 43 | 43 - 47.5 | 43 - 47.5 | 47.5 - 52.5 | 47.5 - 52.5 | 52.5 - 57 | 52.5 - 57 |
| Hip (in) | 28.5 - 31.5 | 31.5 - 35 | 35 - 37.5 | 35 - 37.5 | 37.5 - 41 | 37.5 - 41 | 41 - 44 | 41 - 44 | 44 - 47 | 44 - 47 | 47 - 50.5 | 47 - 50.5 | 50.5 - 53.5 | 50.5 - 53.5 | 53.5 - 58.5 | 53.5 - 58.5 |
      `,
    },
  });

  assert.ok(result.guide);
  assert.equal(result.report.followedUrl, undefined);
  assert.equal(result.guide.guide.matrixOrientation, "size-columns");
  assert.equal(result.guide.guide.originalUnitSystem, "in");
  assert.deepEqual(result.guide.guide.originalSizeLabels, [
    "XXS",
    "XS",
    "S",
    "S Tall",
    "M",
    "M Tall",
    "L",
    "L Tall",
    "XL",
    "XL Tall",
    "XXL",
    "XXL Tall",
    "3XL",
    "3XL Tall",
    "4XL",
    "4XL Tall",
  ]);
  assert.equal(result.guide.shoppingAssistantGuide.guide.rows.length, 16);
  assert.equal(result.guide.shoppingAssistantGuide.guide.rows[0]?.dimensions.chestCm?.min, 71.4);
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
  assert.equal(result.report.followedUrl, "https://www.nike.com/size-fit/mens-tops-alpha");
  assert.deepEqual(
    result.guide.guide.sourceTraceChain.map((step) => step.url),
    ["https://www.nike.com/size-fit-guide", "https://www.nike.com/size-fit/mens-tops-alpha"],
  );
  const productLink = result.report.linkCandidates.find((link) =>
    link.label.includes("Dri-FIT Legend"),
  );
  assert.equal(productLink?.selected, false);
  assert.ok(productLink?.rejectionReasons.some((reason) => reason.includes("product page")));
  const feedbackLink = result.report.linkCandidates.find((link) => link.label.includes("Feedback"));
  assert.equal(feedbackLink?.selected, false);
  assert.ok(feedbackLink?.rejectionReasons.some((reason) => reason.includes("utility navigation")));
});

test("Navigation ignores image assets before Firecrawl rendering", () => {
  const sourceUrl = "https://www.hm.com/size-guide";
  const links = discoverLinkCandidates({
    html: `
      <a href="https://image.hm.com/assets/hm/example.jpg?imwidth=1536">
        Men's tops size chart image
      </a>
      <a href="/sizeguide/men-tops">Men's Tops Size Guide</a>
    `,
    markdown: `
![Men's tops size chart](https://image.hm.com/assets/hm/example.jpg?imwidth=1536)
[Men's Tops Size Guide](/sizeguide/men-tops)
    `,
    sourceUrl,
    requestedCategory: mapRequestedGarmentCategory("tshirts"),
    requestedSizeSystem: mapRequestedSizeSystem("INT"),
  });

  assert.equal(
    links.some((link) => link.url.includes("image.hm.com")),
    false,
  );
  assert.ok(links.some((link) => link.url === "https://www.hm.com/sizeguide/men-tops"));
});

test("Navigation does not follow marketing utility links as size guides", () => {
  const sourceUrl = "https://www.hugoboss.com/size-guide";
  const requestedCategory = mapRequestedGarmentCategory("tshirts");
  const links = discoverLinkCandidates({
    html: `
      <a href="/size-guide#cookie">Cookie settings</a>
      <a href="/en-us/gifts/">The Gift Guide</a>
      <a href="/rlmag/men">Style Guide: Men</a>
      <a href="/size-chart/womens-tops">Women</a>
      <a href="/size-chart/boys-tops">Boys</a>
      <a href="/size-chart/girls-tops">Girls</a>
      <a href="/size-chart/men-tops">Men's Tops Size Chart</a>
    `,
    markdown: "",
    sourceUrl,
    requestedCategory,
    requestedSizeSystem: mapRequestedSizeSystem("INT"),
  });
  const navigation = selectHubFollowLinks({ linkCandidates: links, requestedCategory });

  assert.deepEqual(
    navigation.selected.map((link) => link.url),
    ["https://www.hugoboss.com/size-chart/men-tops"],
  );
  assert.ok(
    navigation.linkCandidates
      .filter((link) =>
        ["Cookie settings", "The Gift Guide", "Style Guide: Men"].includes(link.label),
      )
      .every((link) => link.selected === false),
  );
  const byLabel = new Map(navigation.linkCandidates.map((link) => [link.label, link]));

  for (const label of ["Women", "Boys", "Girls"]) {
    const candidate = byLabel.get(label);
    assert.ok(candidate, `Missing candidate ${label}`);
    assert.equal(
      candidate.reasons.some((reason) => reason.includes("men's context")),
      false,
      `${label} must not receive men's context scoring`,
    );
    assert.equal(candidate.selected, false);
  }

  assert.ok(
    byLabel
      .get("Women")
      ?.rejectionReasons.some((reason) => reason.includes("explicitly targets women")),
  );
  assert.ok(
    byLabel
      .get("Boys")
      ?.rejectionReasons.some((reason) => reason.includes("explicitly targets kids")),
  );
  assert.ok(
    byLabel
      .get("Girls")
      ?.rejectionReasons.some((reason) => reason.includes("explicitly targets kids")),
  );
});

test("Navigation treats same-brand regional domains as internal", () => {
  const sourceUrl = "https://www.calvinklein.com/size-guide";
  const links = discoverLinkCandidates({
    html: `
      <a href="https://www.calvinklein.us/en/men-size-guide.html">Men's Size Guide</a>
    `,
    markdown: "",
    sourceUrl,
    requestedCategory: mapRequestedGarmentCategory("tshirts"),
    requestedSizeSystem: mapRequestedSizeSystem("INT"),
  });
  const navigation = selectHubFollowLinks({ linkCandidates: links });

  assert.deepEqual(
    navigation.selected.map((link) => link.url),
    ["https://www.calvinklein.us/en/men-size-guide.html"],
  );
  assert.ok(navigation.selected[0]?.reasons.some((reason) => reason.includes("men's context")));
});

test("Navigation treats Banana Republic gap-hosted guides as same brand", () => {
  const sourceUrl = "https://www.bananarepublic.com/size-guide";
  const links = discoverLinkCandidates({
    html: `
      <a href="https://bananarepublic.gap.com/customerService/info.do?cid=80743&cs=size_charts">Men's Size Guide</a>
    `,
    markdown: "",
    sourceUrl,
    requestedCategory: mapRequestedGarmentCategory("tshirts"),
    requestedSizeSystem: mapRequestedSizeSystem("INT"),
  });
  const navigation = selectHubFollowLinks({ linkCandidates: links });

  assert.deepEqual(
    navigation.selected.map((link) => link.url),
    ["https://bananarepublic.gap.com/customerService/info.do?cid=80743&cs=size_charts"],
  );
  assert.ok(navigation.selected[0]?.reasons.some((reason) => reason.includes("same brand domain")));
});

test("Navigation rejects same-page anchors, utility links, and image CDN links", () => {
  const requestedCategory = mapRequestedGarmentCategory("tshirts");
  const decathlonUrl = "https://www.decathlon.fr/landing/size-guide";
  const decathlonLinks = discoverLinkCandidates({
    html: `
      <a href="https://www.decathlon.fr/landing/size-guide#content">Voir le contenu</a>
      <a href="https://www.decathlon.fr/landing/size-guide#footer">Accéder au haut de la page</a>
      <a href="https://www.decathlon.fr/landing/size-guide#search-input-header-modal">Rechercher</a>
      <a href="/landing/size-guide/men-tops">Men's Tops Size Guide</a>
    `,
    markdown: "",
    sourceUrl: decathlonUrl,
    requestedCategory,
    requestedSizeSystem: mapRequestedSizeSystem("INT"),
  });
  const decathlonNav = selectHubFollowLinks({
    linkCandidates: decathlonLinks,
    requestedCategory,
  });
  const decathlonByLabel = new Map(decathlonNav.linkCandidates.map((link) => [link.label, link]));

  for (const label of ["Voir le contenu", "Accéder au haut de la page", "Rechercher"]) {
    const candidate = decathlonByLabel.get(label);
    assert.ok(candidate, `Missing candidate ${label}`);
    assert.equal(candidate.score, -99);
    assert.equal(candidate.selected, false);
  }

  const amiUrl = "https://www.amiparis.com/en-us/size-guide";
  const amiLinks = discoverLinkCandidates({
    html: `
      <a href="https://www.amiparis.com/en-us/size-guide#header-desktop">Link to main navigation</a>
      <a href="https://www.amiparis.com/en-us/size-guide#header__search--desktop">Link to search</a>
      <a href="https://www.amiparis.com/en-us/size-guide#shopify-section-footer">Link to footer</a>
      <a href="/en-us/size-guide/mens-tops">Men's Tops Size Guide</a>
    `,
    markdown: "",
    sourceUrl: amiUrl,
    requestedCategory,
    requestedSizeSystem: mapRequestedSizeSystem("INT"),
  });
  const amiNav = selectHubFollowLinks({ linkCandidates: amiLinks, requestedCategory });
  assert.ok(
    amiNav.linkCandidates
      .filter((link) => link.url.includes("#"))
      .every((link) => link.score === -99 && link.selected === false),
  );

  const hugoLinks = discoverLinkCandidates({
    html: `
      <a href="https://images.hugoboss.com/is/image/hugobosscsprod/example.jpg">![HB image]</a>
      <a href="https://www.hugoboss.com/size-chart/men-tops">Men's Tops Size Guide</a>
    `,
    markdown: `
![HB image](https://images.hugoboss.com/is/image/hugobosscsprod/example.jpg)
[Men's Tops Size Guide](https://www.hugoboss.com/size-chart/men-tops)
    `,
    sourceUrl: "https://www.hugoboss.com/size-guide",
    requestedCategory,
    requestedSizeSystem: mapRequestedSizeSystem("INT"),
  });
  assert.equal(
    hugoLinks.some((link) => link.url.includes("images.hugoboss.com")),
    false,
  );
});

test("Dead guide pages fail without following same-page anchors", async () => {
  let fetchCalls = 0;
  const result = await runFixture({
    brand: "Decathlon",
    fixture: {
      url: "https://www.decathlon.fr/landing/size-guide",
      html: `
        <html>
          <body>
            <h1>Vous cherchez votre chemin ?</h1>
            <p>On vous aide à le retrouver sur notre site.</p>
            <a href="https://www.decathlon.fr/landing/size-guide#content">Voir le contenu</a>
            <a href="https://www.decathlon.fr/landing/size-guide#footer">Accéder au haut de la page</a>
          </body>
        </html>
      `,
      markdown: `
# Vous cherchez votre chemin ?
On vous aide à le retrouver sur notre site.
[Voir le contenu](https://www.decathlon.fr/landing/size-guide#content)
[Accéder au haut de la page](https://www.decathlon.fr/landing/size-guide#footer)
      `,
    },
    fetchDocument: async () => {
      fetchCalls += 1;
      throw new Error("Dead page should not follow links");
    },
  });

  assert.equal(result.guide, undefined);
  assert.equal(fetchCalls, 0);
  assert.equal(result.report.followedUrl, undefined);
  assert.equal(result.report.linkCandidates.length, 0);
  assert.ok(
    result.report.validationErrors.some((issue) => issue.code === "page-not-found-document"),
  );
  assert.ok(
    result.report.documentReasoning.some((reason) => reason.includes("404/page-not-found")),
  );
});

test("Brand fallback uses the known New Balance apparel guide when the hub is empty", async () => {
  const sourceUrl = "https://www.newbalance.com/size-chart";
  const fallbackUrl = "https://www.newbalance.com/customercare-sizeguide-apparel.html";
  const fetchedUrls: string[] = [];
  const result = await runFixture({
    brand: "New Balance",
    fixture: {
      url: sourceUrl,
      html: "<html><body><h1>Size chart</h1><p>Select your size guide.</p></body></html>",
      markdown: "# Size chart\n\nSelect your size guide.",
    },
    fetchDocument: async (url, options) => {
      fetchedUrls.push(url);
      assert.equal(options?.renderer, "firecrawl");
      if (url === sourceUrl) {
        return {
          sourceUrl,
          html: "<html><body><h1>Size chart</h1><p>Select your size guide.</p></body></html>",
          markdown: "# Size chart\n\nSelect your size guide.",
        };
      }

      assert.equal(url, fallbackUrl);
      return {
        ...renderedTopGuide,
        sourceUrl: fallbackUrl,
      };
    },
  });

  assert.ok(result.guide);
  assert.deepEqual(fetchedUrls, [fallbackUrl]);
  assert.equal(result.report.followedUrl, fallbackUrl);
  assert.equal(result.guide.guide.sourceTraceChain[1]?.kind, "brand-fallback");
});

test("Under Armour shorthand labels and implicit inch units validate deterministically", async () => {
  const result = await runFixture({
    brand: "Under Armour",
    fixture: {
      url: "https://www.underarmour.com/en-us/t/size-guide/mens-tops/",
      html: `
        <h1>Men's Tops Size Chart</h1>
        <table>
          <tr><th>Size</th><th>Chest</th><th>Waist</th><th>Hips</th></tr>
          <tr><td>XS</td><td>30-32</td><td>26-27</td><td>32-33</td></tr>
          <tr><td>SM</td><td>34-36</td><td>28-29</td><td>34-35</td></tr>
          <tr><td>MD</td><td>38-40</td><td>30-32</td><td>36-38</td></tr>
          <tr><td>LG</td><td>42-44</td><td>34-36</td><td>40-42</td></tr>
          <tr><td>XL</td><td>46-48</td><td>38-40</td><td>44-46</td></tr>
        </table>
      `,
      markdown: "",
    },
  });

  assert.ok(result.guide);
  assert.equal(result.guide.guide.originalUnitSystem, "in");
  assert.deepEqual(
    result.guide.guide.rows.map((row) => row.canonicalLabel),
    ["XS", "S", "M", "L", "XL"],
  );
  assert.equal(result.report.aiFallbackAttempt, undefined);
});

test("Columbia-style IN CM unit toggles do not force inch tables to centimeters", async () => {
  const result = await runFixture({
    brand: "Columbia",
    fixture: {
      url: "https://www.columbia.com/sizefit?isPage=true&r=1",
      html: `
        <h1>Men's Tops Size Chart</h1>
        <p>Standard IN CM</p>
        <table>
          <tr><th>Size</th><th>Chest</th><th>Waist</th><th>Hips</th></tr>
          <tr><td>XS</td><td>35</td><td>29</td><td>34</td></tr>
          <tr><td>S</td><td>36-37</td><td>30-31</td><td>35-36</td></tr>
          <tr><td>M</td><td>39-41</td><td>33-35</td><td>38-40</td></tr>
          <tr><td>L</td><td>42.5-44</td><td>36-38</td><td>41.5-43</td></tr>
          <tr><td>XL</td><td>46.5-48</td><td>40-42</td><td>44.5-47</td></tr>
          <tr><td>XXL</td><td>50.5-52</td><td>44-46</td><td>49.5-51</td></tr>
        </table>
      `,
      markdown: "",
    },
  });

  assert.ok(result.guide);
  assert.equal(result.guide.guide.originalUnitSystem, "in");
  assert.equal(result.guide.guide.rows[0]?.chestCmMin, 88.9);
});

test("Top-compatible body measurement tables can satisfy tshirts without bottom evidence", async () => {
  const result = await runFixture({
    brand: "Puma",
    fixture: {
      url: "https://nz.puma.com/nz/en/sizecharts/sizecharts.html",
      html: `
        <h1>Men's Body Measurements</h1>
        <table>
          <tr><th>Size</th><th>Chest (cm)</th><th>Waist (cm)</th><th>Hips (cm)</th></tr>
          <tr><td>XS</td><td>84-89</td><td>70-75</td><td>85-90</td></tr>
          <tr><td>S</td><td>90-95</td><td>76-81</td><td>91-96</td></tr>
          <tr><td>M</td><td>96-101</td><td>82-87</td><td>97-102</td></tr>
          <tr><td>L</td><td>102-107</td><td>88-93</td><td>103-108</td></tr>
          <tr><td>XL</td><td>108-113</td><td>94-99</td><td>109-114</td></tr>
        </table>
      `,
      markdown: "",
    },
  });

  assert.ok(result.guide);
  assert.equal(result.guide.guide.garmentCategory, "tshirts");
  assert.equal(result.guide.guide.sourceType, "generic-body-guide");
  assert.equal(result.report.validationStatus, "accepted");
});

test("Pipeline rejects women audience tables for the implicit men's target", async () => {
  const result = await runFixture({
    brand: "Decathlon",
    fixture: {
      url: "https://www.decathlon.fr/landing/size-guide",
      html: `
        <h1>Hauts Femme / Women's Tops</h1>
        <table>
          <tr><th>Size</th><th>Chest (cm)</th><th>Waist (cm)</th></tr>
          <tr><td>XS</td><td>82-86</td><td>66-70</td></tr>
          <tr><td>S</td><td>87-91</td><td>71-75</td></tr>
          <tr><td>M</td><td>92-96</td><td>76-80</td></tr>
        </table>
      `,
      markdown: `
## Hauts Femme / Women's Tops
| Size | Chest (cm) | Waist (cm) |
| --- | --- | --- |
| XS | 82-86 | 66-70 |
| S | 87-91 | 71-75 |
| M | 92-96 | 76-80 |
      `,
    },
  });

  assert.equal(result.guide, undefined);
  assert.equal(result.report.manualReviewRecommended, true);
  assert.ok(
    result.report.validationErrors.some(
      (issue) => issue.code === "repair_candidate_wrong_audience",
    ),
  );
});

test("Pipeline refetches followed brand fallback pages with Firecrawl rendering", async () => {
  const fallbackUrl = "https://www.nike.com/size-fit/mens-tops-alpha";
  const fetchModes: string[] = [];
  const result = await runFixture({
    brand: "Nike",
    fixture: {
      url: "https://www.nike.com/size-fit-guide",
      html: "<html><body><h1>Nike Size Fit Guide</h1><p>Find your fit.</p></body></html>",
      markdown: "# Nike Size Fit Guide\n\nFind your fit.",
    },
    fetchDocument: async (url, options) => {
      assert.equal(url, fallbackUrl);
      fetchModes.push(options?.renderer ?? "auto");
      assert.equal(options?.renderer, "firecrawl");
      return renderedTopGuide;
    },
  });

  assert.ok(result.guide);
  assert.deepEqual(fetchModes, ["firecrawl"]);
  assert.equal(result.report.followedUrl, fallbackUrl);
  assert.equal(result.guide.guide.sourceTraceChain[1]?.kind, "brand-fallback");
  assert.ok(
    result.report.documentReasoning.some((reason) => reason.includes("Firecrawl rendering")),
  );
});

test("Pipeline refetches direct official guide URLs with Firecrawl rendering", async () => {
  const directUrl = "https://www.nike.com/size-fit/mens-tops-alpha";
  const fetchModes: string[] = [];
  const result = await runFixture({
    brand: "Nike",
    fixture: {
      url: directUrl,
      html: `
        <html>
          <body>
            <h1>Men's Tops Size Guide</h1>
            <p>Loading chart.</p>
            <a href="https://www.nike.com/size-fit-guide">Size Charts</a>
          </body>
        </html>
      `,
      markdown:
        "# Men's Tops Size Guide\n\nLoading chart.\n\n[Size Charts](https://www.nike.com/size-fit-guide)",
    },
    fetchDocument: async (url, options) => {
      assert.equal(url, directUrl);
      fetchModes.push(options?.renderer ?? "auto");
      assert.equal(options?.renderer, "firecrawl");
      return renderedTopGuide;
    },
  });

  assert.ok(result.guide);
  assert.deepEqual(fetchModes, ["firecrawl"]);
  assert.equal(result.report.resolvedSourceUrl, directUrl);
  assert.ok(
    result.report.documentReasoning.some((reason) => reason.includes("Firecrawl rendering")),
  );
});

test("Adidas direct page prefers the cm table over a duplicate inch table", async () => {
  const result = await runFixture({
    brand: "Adidas",
    fixture: fixtures.adidasDualUnitTops,
  });

  assert.ok(result.guide);
  assert.equal(result.guide.guide.originalUnitSystem, "cm");
  assert.deepEqual(result.guide.guide.originalSizeLabels, ["XS", "S", "M", "L", "XL"]);
  assert.equal(result.guide.shoppingAssistantGuide.guide.rows[0]?.dimensions.chestCm?.min, 83);
});

test("Pipeline retries a fallback size system after the primary INT target fails", async () => {
  const result = await runFixture({
    brand: "Fallback US",
    fixture: fixtures.usNumericTops,
    sizeSystem: "INT",
    fallbackSizeSystem: "US",
  });

  assert.ok(result.guide);
  assert.equal(result.report.requestedSizeSystem, "US");
  assert.equal(result.guide.guide.sizeSystem, "US");
  assert.equal(result.guide.guide.originalSizeLabels[0], "34");
  assert.ok(result.report.warnings.some((warning) => warning.code === "fallback-size-system-used"));
});

test("Pipeline does not try fallback size system after a category failure", async () => {
  const result = await runFixture({
    brand: "Invalid Tops",
    fixture: fixtures.invalidTopWithInseam,
    sizeSystem: "INT",
    fallbackSizeSystem: "EU",
  });

  assert.equal(result.guide, undefined);
  assert.equal(result.report.requestedSizeSystem, "INT");
  assert.ok(
    result.report.validationErrors.some((issue) => issue.code === "no-unique-section-match"),
  );
  assert.equal(
    result.report.warnings.some((warning) =>
      ["fallback-size-system-used", "fallback-size-system-skipped"].includes(warning.code),
    ),
    false,
  );
});

test("Pipeline accepts Firecrawl LLM fallback only after strict validation passes", async () => {
  const result = await runFixture({
    brand: "LLM Tops",
    fixture: llmOnlyTopFixture,
    llmExtractCandidate: async () => ({
      rows: llmTopRows(),
      extractedFieldKeys: ["chest"],
      warnings: [],
      score: 0.74,
    }),
  });

  assert.ok(result.guide);
  assert.equal(result.report.validationStatus, "accepted");
  assert.equal(result.report.aiFallbackAttempt?.status, "accepted");
  assert.equal(result.report.candidateExtractions[0]?.strategy, "none");
  assert.equal(result.report.candidateExtractions[1]?.strategy, "llm");
  assert.equal(result.guide.guide.extractionConfidence, 0.74);
  assert.equal(result.guide.guide.rows.length, 5);
});

test("Pipeline blocks Nike-like LLM rows that fuse tops and bottoms evidence", async () => {
  const result = await runFixture({
    brand: "Invalid LLM Tops",
    fixture: llmOnlyTopFixture,
    llmExtractCandidate: async () => ({
      rows: llmTopRows(true),
      extractedFieldKeys: ["chest", "inseam"],
      warnings: [],
      score: 0.74,
    }),
  });

  assert.equal(result.guide, undefined);
  assert.equal(result.report.manualReviewRecommended, true);
  assert.equal(result.report.aiFallbackAttempt?.status, "rejected");
  assert.equal(result.report.candidateExtractions.at(-1)?.strategy, "llm");
  assert.equal(result.report.candidateExtractions.at(-1)?.rows.length, 5);
  assert.ok(
    result.report.validationErrors.some((issue) =>
      ["fused-top-bottom-evidence", "top-has-inseam"].includes(issue.code),
    ),
  );
});

test("Pipeline does not run LLM fallback when no candidate section exists", async () => {
  let llmCalls = 0;
  const result = await runFixture({
    brand: "No Candidate",
    fixture: {
      url: "https://example.com/no-size-guide",
      html: "<html><body><h1>Shipping and returns</h1><p>No size data here.</p></body></html>",
      markdown: "# Shipping and returns\n\nNo size data here.",
    },
    llmExtractCandidate: async () => {
      llmCalls += 1;
      return {
        rows: llmTopRows(),
        extractedFieldKeys: ["chest"],
        warnings: [],
        score: 0.74,
      };
    },
  });

  assert.equal(result.guide, undefined);
  assert.equal(llmCalls, 0);
  assert.equal(result.report.aiFallbackAttempt, undefined);
});

test("Adidas multi-guide page can extract the selected tops table from a mixed category page", async () => {
  const result = await runFixture({
    brand: "Adidas",
    fixture: fixtures.adidasMulti,
  });

  assert.ok(result.guide);
  assert.equal(result.guide.guide.sourceSectionTitle, "Men's Shirts & Tops");
  assert.equal(result.guide.guide.garmentCategory, "tshirts");
  assert.ok(result.report.warnings.some((issue) => issue.code === "multiple-categories-detected"));
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

test("Reebok mixed guide page extracts the tops table without following product links", async () => {
  const result = await runFixture({
    brand: "Reebok",
    fixture: fixtures.reebokMulti,
  });

  assert.ok(result.guide);
  assert.equal(result.guide.guide.sourceSectionTitle, "Men's Tops Size Guide");
  assert.equal(result.guide.guide.garmentCategory, "tshirts");
  assert.ok(result.report.warnings.some((issue) => issue.code === "multiple-categories-detected"));
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
  assert.equal(
    result.report.followedUrl,
    "https://www.underarmour.com/en-us/t/size-guide/mens-tops/",
  );
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
