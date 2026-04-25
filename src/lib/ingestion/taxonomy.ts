import type {
  CategoryMappingMode,
  DetectedGarmentCategory,
  DetectedSizeSystem,
  FitVariant,
  GarmentCategory,
  MeasurementField,
  SizeSystem,
} from "@/lib/types";

export function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsAny(text: string, patterns: string[]): boolean {
  const normalizedText = ` ${normalizeToken(text)} `;
  return patterns.some((pattern) => {
    const normalizedPattern = normalizeToken(pattern);
    return Boolean(normalizedPattern) && normalizedText.includes(` ${normalizedPattern} `);
  });
}

const TOP_KEYWORDS = ["top", "tops", "haut", "hauts", "upper body"];
const BOTTOM_KEYWORDS = ["bottom", "bottoms", "bas", "lower body"];
const OUTERWEAR_KEYWORDS = [
  "jacket",
  "jackets",
  "coat",
  "coats",
  "outerwear",
  "manteau",
  "manteaux",
  "veste",
  "vestes",
  "parka",
  "parkas",
  "doudoune",
  "doudounes",
];
const BROAD_TOP_LABELS = [
  "tops tees",
  "tees tops",
  "shirts tops",
  "tops shirts",
  "tops tees size guide",
  "shirts tops size guide",
];

function hasExplicitNumericSystemLabel(label: string): DetectedSizeSystem | null {
  const normalized = ` ${normalizeToken(label)} `;
  if (containsAny(normalized, [" us ", " us size", " size us"])) return "US";
  if (containsAny(normalized, [" uk ", " uk size", " size uk"])) return "UK";
  if (containsAny(normalized, [" eu ", " eu size", " size eu"])) return "EU";
  if (containsAny(normalized, [" fr ", " fr size", " size fr"])) return "FR";
  if (containsAny(normalized, [" it ", " it size", " size it"])) return "IT";
  return null;
}

function isNumericOnlyLabel(label: string): boolean {
  const normalized = normalizeToken(label);
  return /^\d{2,3}(\/\d{2,3})?$/.test(normalized);
}

function isInternationalSizeLabel(label: string): boolean {
  const normalized = normalizeToken(label);
  return /^(xxs|xs|s|sm|m|md|l|lg|xl|xxl|2xl|xxxl|3xl|4xl|5xl)( tall| petite| regular| short| long)?$/.test(
    normalized,
  );
}

function detectAxisSizeSystem(labels: string[]): DetectedSizeSystem {
  const normalized = labels.map((label) => normalizeToken(label)).filter(Boolean);

  if (!normalized.length) return "UNKNOWN";
  if (normalized.some((label) => isInternationalSizeLabel(label))) return "INT";
  if (
    normalized.some(
      (label) => /^w\d+\s*l\d+$/.test(label) || /^\d{2,3}\/\d{2,3}$/.test(label),
    )
  ) {
    return "WAIST_INSEAM";
  }

  const explicitSystems = new Set(
    normalized
      .map((label) => hasExplicitNumericSystemLabel(label))
      .filter((label): label is Exclude<DetectedSizeSystem, "UNKNOWN"> => Boolean(label)),
  );
  if (explicitSystems.size === 1) {
    return Array.from(explicitSystems)[0] ?? "UNKNOWN";
  }

  if (normalized.length > 0 && normalized.every((label) => isNumericOnlyLabel(label))) {
    return "NUMERIC";
  }

  return "UNKNOWN";
}

export function mapRequestedGarmentCategory(raw?: string): GarmentCategory | null {
  const text = normalizeToken(raw ?? "");
  if (!text) return null;
  if (text === "top" || text === "tops") {
    return "tshirts";
  }
  if (containsAny(text, ["t shirt", "tshirt", "tshirts", "tee", "tees"])) {
    return "tshirts";
  }
  if (containsAny(text, ["shirt", "shirts", "chemise", "chemises"])) {
    return "shirts";
  }
  if (containsAny(text, ["hoodie", "hoodies", "sweatshirt", "sweatshirts"])) {
    return "hoodies";
  }
  if (containsAny(text, OUTERWEAR_KEYWORDS)) {
    return "jackets";
  }
  if (containsAny(text, ["jean", "jeans", "denim"])) {
    return "jeans";
  }
  if (containsAny(text, ["short", "shorts"])) {
    return "shorts";
  }
  if (containsAny(text, ["legging", "leggings", "tight", "tights"])) {
    return "leggings";
  }
  if (
    containsAny(text, [
      "pant",
      "pants",
      "trouser",
      "trousers",
      "pantalon",
      "pantalons",
      "chino",
      "cargos",
      "cargo",
    ])
  ) {
    return "pants";
  }
  if (containsAny(text, ["bra", "bras", "brassiere", "brassieres"])) {
    return "bras";
  }
  if (
    containsAny(text, [
      "shoe",
      "shoes",
      "footwear",
      "sneaker",
      "sneakers",
      "chaussure",
      "chaussures",
    ])
  ) {
    return "shoes";
  }
  if (
    containsAny(text, [
      "generic",
      "body",
      "body guide",
      "body measurement",
      "body measurements",
      "body measure",
      "body measures",
      "guide morphologie",
      "guide des mesures",
      "generic body guide",
    ])
  ) {
    return "generic-body-guide";
  }
  return null;
}

export function mapRequestedSizeSystem(raw?: string): SizeSystem | null {
  const text = normalizeToken(raw ?? "");
  if (!text) return null;
  if (text === "int" || text === "international" || text === "alpha" || text === "letter") {
    return "INT";
  }
  if (text === "eu" || text === "europe" || text === "european") return "EU";
  if (text === "fr" || text === "france" || text === "francais") return "FR";
  if (text === "us" || text === "usa" || text === "american") return "US";
  if (text === "uk" || text === "british") return "UK";
  if (text === "it" || text === "italy" || text === "italian") return "IT";
  if (text === "waist inseam" || text === "waist_inseam") return "WAIST_INSEAM";
  if (text === "footwear" || text === "shoe size") return "FOOTWEAR";
  if (text === "bra") return "BRA";
  return null;
}

export function detectAudience(text: string) {
  const normalized = normalizeToken(text);
  if (
    containsAny(normalized, [
      "kid",
      "kids",
      "child",
      "children",
      "junior",
      "boys",
      "girls",
    ])
  ) {
    return "kids";
  }
  if (containsAny(normalized, ["unisex"])) return "unisex";
  if (
    containsAny(normalized, [
      "women",
      "woman",
      "female",
      "femme",
      "femmes",
      "lady",
      "ladies",
    ])
  ) {
    return "women";
  }
  if (containsAny(normalized, ["men", "man", "male", "homme", "hommes"])) {
    return "men";
  }
  return "unknown";
}

export function detectFitVariant(text: string): FitVariant {
  const normalized = normalizeToken(text);
  if (containsAny(normalized, ["tall", "long"])) return "tall";
  if (containsAny(normalized, ["petite"])) return "petite";
  if (containsAny(normalized, ["regular"])) return "regular";
  if (containsAny(normalized, ["short"])) return "standard";
  if (normalized) return "standard";
  return "unknown";
}

export function isSizeLikeLabel(label: string): boolean {
  const normalized = normalizeToken(label);
  if (!normalized) return false;
  if (isInternationalSizeLabel(label)) return true;
  if (/^\d{2,3}(\/\d{2,3})?( tall| petite| regular| short| long)?$/.test(normalized)) {
    return true;
  }
  if (/^\d{2,3}-\d{2,3}$/.test(normalized)) return true;
  if (/^w\d+\s*l\d+$/.test(normalized)) return true;
  if (/^\d+\s*[a-z]{0,2}$/.test(normalized) && !normalized.includes("cm")) {
    return true;
  }
  return false;
}

export function canonicalizeSizeLabel(label: string): {
  canonicalLabel: string;
  fitVariant: FitVariant;
} {
  const normalized = normalizeToken(label);
  const fitVariant = detectFitVariant(label);
  const stripped = normalized
    .replace(/\b(tall|petite|regular|long|short)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  const shorthandMap: Record<string, string> = {
    SM: "S",
    MD: "M",
    LG: "L",
    "2XL": "XXL",
    XXXL: "3XL",
  };
  const canonicalLabel = shorthandMap[stripped] ?? (stripped || label.trim().toUpperCase());
  return {
    canonicalLabel,
    fitVariant: fitVariant === "unknown" ? "standard" : fitVariant,
  };
}

export function detectSizeSystem(args: {
  rowLabels: string[];
  headers: string[];
  stubColumn?: string[];
  sizeAxisLabels?: string[];
  context: string;
}): DetectedSizeSystem {
  const context = normalizeToken(
    [
      ...args.headers,
      ...args.rowLabels,
      ...(args.stubColumn ?? []),
      ...(args.sizeAxisLabels ?? []),
      args.context,
    ].join(" "),
  );

  const axisDetections = [
    detectAxisSizeSystem(args.sizeAxisLabels ?? []),
    detectAxisSizeSystem(args.rowLabels),
    detectAxisSizeSystem(args.headers),
  ];
  const explicitFromAxis = axisDetections.find(
    (system) => system !== "UNKNOWN" && system !== "NUMERIC",
  );
  if (explicitFromAxis) return explicitFromAxis;
  if (axisDetections.includes("NUMERIC")) return "NUMERIC";

  if (containsAny(context, ["footwear", "shoe size", "chaussure", "shoes"])) {
    return "FOOTWEAR";
  }
  if (containsAny(context, ["bra", "cup size"])) {
    return "BRA";
  }

  const explicit = [
    ...args.headers,
    ...args.rowLabels,
    ...(args.stubColumn ?? []),
    ...(args.sizeAxisLabels ?? []),
  ]
    .map((label) => hasExplicitNumericSystemLabel(label))
    .find((label): label is Exclude<DetectedSizeSystem, "UNKNOWN" | "NUMERIC"> =>
      Boolean(label),
    );
  if (explicit) return explicit;

  return "UNKNOWN";
}

export function detectCategory(args: {
  sectionTitle: string;
  subheading?: string;
  headers: string[];
  rowLabels: string[];
  stubColumn?: string[];
  nearbyText: string;
  fields: MeasurementField[];
}): {
  garmentFamily: "tops" | "bottoms" | "shoes" | "bras" | "body" | "unknown";
  detectedCategory: DetectedGarmentCategory;
  detectedCategoryLabel: string;
  reasons: string[];
} {
  const labelSources = [
    args.sectionTitle,
    args.subheading ?? "",
    ...args.headers,
    ...(args.stubColumn ?? []),
    ...args.rowLabels,
    args.nearbyText,
  ];
  const text = normalizeToken(labelSources.join(" "));
  const sectionText = normalizeToken(
    [args.sectionTitle, args.subheading ?? "", ...args.headers].join(" "),
  );
  const reasons: string[] = [];
  const hasChest = args.fields.includes("chest");
  const hasInseam = args.fields.includes("inseam");
  const hasFoot =
    args.fields.includes("footLength") || args.fields.includes("footWidth");

  if (hasChest && hasInseam) {
    reasons.push("Section mixes chest and inseam fields, which suggests a broad body guide.");
    return {
      garmentFamily: "body",
      detectedCategory: "generic-body-guide",
      detectedCategoryLabel: args.sectionTitle || "generic body guide",
      reasons,
    };
  }

  if (
    containsAny(sectionText, [
      "body measurement",
      "body measurements",
      "body measure",
      "body measures",
      "body guide",
      "guide des mesures",
      "size advice",
      "fit advice",
      "how to measure",
    ])
  ) {
    reasons.push("Section title is labeled as body guidance or size advice.");
    return {
      garmentFamily: "body",
      detectedCategory: "generic-body-guide",
      detectedCategoryLabel: args.sectionTitle || "generic body guide",
      reasons,
    };
  }

  if (
    hasFoot ||
    containsAny(text, [
      "footwear",
      "foot length",
      "foot width",
      "shoe",
      "shoes",
      "chaussure",
      "chaussures",
    ])
  ) {
    reasons.push("Footwear keywords or foot measurements are present.");
    return {
      garmentFamily: "shoes",
      detectedCategory: "shoes",
      detectedCategoryLabel: args.sectionTitle || "shoes",
      reasons,
    };
  }

  if (containsAny(text, ["bra", "bras", "brassiere", "cup"])) {
    reasons.push("Bra-specific keywords are present.");
    return {
      garmentFamily: "bras",
      detectedCategory: "bras",
      detectedCategoryLabel: args.sectionTitle || "bras",
      reasons,
    };
  }

  if (containsAny(text, ["jean", "jeans", "denim"])) {
    reasons.push("Jeans-specific keywords are present.");
    return {
      garmentFamily: "bottoms",
      detectedCategory: "jeans",
      detectedCategoryLabel: args.sectionTitle || "jeans",
      reasons,
    };
  }

  if (containsAny(text, ["short", "shorts"])) {
    reasons.push("Shorts-specific keywords are present.");
    return {
      garmentFamily: "bottoms",
      detectedCategory: "shorts",
      detectedCategoryLabel: args.sectionTitle || "shorts",
      reasons,
    };
  }

  if (containsAny(text, ["legging", "leggings", "tight", "tights"])) {
    reasons.push("Leggings-specific keywords are present.");
    return {
      garmentFamily: "bottoms",
      detectedCategory: "leggings",
      detectedCategoryLabel: args.sectionTitle || "leggings",
      reasons,
    };
  }

  if (
    containsAny(text, [
      "pant",
      "pants",
      "trouser",
      "trousers",
      "pantalon",
      "pantalons",
      "chino",
      "cargo",
    ])
  ) {
    reasons.push("Pants-specific keywords are present.");
    return {
      garmentFamily: "bottoms",
      detectedCategory: "pants",
      detectedCategoryLabel: args.sectionTitle || "pants",
      reasons,
    };
  }

  if (containsAny(text, BROAD_TOP_LABELS)) {
    reasons.push("Section uses a broad tops label that needs curated mapping.");
    return {
      garmentFamily: "tops",
      detectedCategory: "tops",
      detectedCategoryLabel: args.sectionTitle || "tops",
      reasons,
    };
  }

  if (containsAny(text, ["t shirt", "tshirts", "tshirt", "tee", "tees"])) {
    reasons.push("T-shirt keywords are present.");
    return {
      garmentFamily: "tops",
      detectedCategory: "tshirts",
      detectedCategoryLabel: args.sectionTitle || "tshirts",
      reasons,
    };
  }

  if (containsAny(text, ["shirt", "shirts", "chemise", "chemises"])) {
    reasons.push("Shirt-specific keywords are present.");
    return {
      garmentFamily: "tops",
      detectedCategory: "shirts",
      detectedCategoryLabel: args.sectionTitle || "shirts",
      reasons,
    };
  }

  if (containsAny(text, ["hoodie", "hoodies", "sweatshirt", "sweatshirts"])) {
    reasons.push("Hoodie keywords are present.");
    return {
      garmentFamily: "tops",
      detectedCategory: "hoodies",
      detectedCategoryLabel: args.sectionTitle || "hoodies",
      reasons,
    };
  }

  if (containsAny(text, OUTERWEAR_KEYWORDS)) {
    reasons.push("Outerwear keywords are present.");
    return {
      garmentFamily: "tops",
      detectedCategory: "jackets",
      detectedCategoryLabel: args.sectionTitle || "jackets",
      reasons,
    };
  }

  if (containsAny(text, TOP_KEYWORDS) || hasChest) {
    reasons.push("The section looks like a broad tops guide.");
    return {
      garmentFamily: "tops",
      detectedCategory: "tops",
      detectedCategoryLabel: args.sectionTitle || "tops",
      reasons,
    };
  }

  if (containsAny(text, BOTTOM_KEYWORDS) || hasInseam) {
    reasons.push("The section looks like a broad bottoms guide.");
    return {
      garmentFamily: "bottoms",
      detectedCategory: "bottoms",
      detectedCategoryLabel: args.sectionTitle || "bottoms",
      reasons,
    };
  }

  return {
    garmentFamily: "unknown",
    detectedCategory: "unknown",
    detectedCategoryLabel: args.sectionTitle || "unknown",
    reasons: ["No garment-specific evidence was strong enough."],
  };
}

export function detectCategoryMapping(args: {
  detectedCategory: DetectedGarmentCategory;
  detectedCategoryLabel: string;
  sectionTitle: string;
  subheading?: string;
  nearbyText: string;
  fields: MeasurementField[];
}): {
  mode: CategoryMappingMode;
  reason?: string;
} {
  const text = normalizeToken(
    [
      args.detectedCategoryLabel,
      args.sectionTitle,
      args.subheading ?? "",
      args.nearbyText,
    ].join(" "),
  );
  const paddedText = ` ${text} `;
  const hasOuterwear = containsAny(text, OUTERWEAR_KEYWORDS);
  const hasBottoms = containsAny(text, BOTTOM_KEYWORDS) || args.fields.includes("inseam");
  const topOnlyFields =
    args.fields.length > 0 &&
    args.fields.every((field) =>
      ["chest", "waist", "hips", "height", "sleeve", "neck", "shoulder"].includes(field),
    );

  if (args.detectedCategory === "generic-body-guide") {
    return {
      mode: "generic-body",
      reason: "The section is explicitly labeled as body guidance.",
    };
  }

  if (args.detectedCategory !== "tops") {
    return {
      mode: args.detectedCategory === "unknown" ? "unknown" : "exact",
    };
  }

  if (containsAny(text, ["tops tees", "tees tops", "shirts tops", "tops shirts"])) {
    return {
      mode: "curated-broad-top",
      reason: `Mapped "${args.detectedCategoryLabel}" into a curated tops-to-tshirts match.`,
    };
  }

  if (containsAny(paddedText, [" top ", " tops ", " haut ", " hauts "]) && !hasOuterwear && !hasBottoms && topOnlyFields) {
    return {
      mode: "curated-broad-top",
      reason: `Mapped broad top label "${args.detectedCategoryLabel}" into tshirts because only top fields were present.`,
    };
  }

  return {
    mode: "unknown",
  };
}

export function resolveRequestedCategoryMatch(args: {
  requestedCategory: GarmentCategory | null;
  detectedCategory: DetectedGarmentCategory;
  categoryMappingMode: CategoryMappingMode;
}): {
  matchedCategory: GarmentCategory | null;
  mode: "exact" | "curated" | "generic-body" | "none";
  reason?: string;
} {
  if (!args.requestedCategory) {
    if (
      args.detectedCategory === "tshirts" ||
      args.detectedCategory === "shirts" ||
      args.detectedCategory === "hoodies" ||
      args.detectedCategory === "jackets" ||
      args.detectedCategory === "pants" ||
      args.detectedCategory === "jeans" ||
      args.detectedCategory === "shorts" ||
      args.detectedCategory === "leggings" ||
      args.detectedCategory === "bras" ||
      args.detectedCategory === "shoes" ||
      args.detectedCategory === "generic-body-guide"
    ) {
      return {
        matchedCategory: args.detectedCategory,
        mode: args.detectedCategory === "generic-body-guide" ? "generic-body" : "exact",
      };
    }
    return { matchedCategory: null, mode: "none" };
  }

  if (args.detectedCategory === args.requestedCategory) {
    return {
      matchedCategory: args.requestedCategory,
      mode: "exact",
    };
  }

  if (
    args.requestedCategory === "generic-body-guide" &&
    args.detectedCategory === "generic-body-guide"
  ) {
    return {
      matchedCategory: "generic-body-guide",
      mode: "generic-body",
    };
  }

  if (
    args.requestedCategory === "tshirts" &&
    (args.detectedCategory === "tops" ||
      args.detectedCategory === "shirts" ||
      args.detectedCategory === "hoodies" ||
      args.detectedCategory === "jackets")
  ) {
    return {
      matchedCategory: "tshirts",
      mode: "curated",
      reason: "Top-family guide evidence matched the requested tshirts category.",
    };
  }

  return { matchedCategory: null, mode: "none" };
}

export function isTopCategory(category: GarmentCategory): boolean {
  return (
    category === "tshirts" ||
    category === "shirts" ||
    category === "hoodies" ||
    category === "jackets"
  );
}

export function isBottomCategory(category: GarmentCategory): boolean {
  return (
    category === "pants" ||
    category === "jeans" ||
    category === "shorts" ||
    category === "leggings"
  );
}
