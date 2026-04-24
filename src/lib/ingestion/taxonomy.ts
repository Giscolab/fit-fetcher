import type {
  Audience,
  DetectedGarmentCategory,
  DetectedSizeSystem,
  FitVariant,
  GarmentCategory,
  MeasurementField,
  SizeSystem,
} from "@/lib/types";

function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

const TOP_KEYWORDS = [
  "top",
  "tops",
  "haut",
  "hauts",
  "upper body",
];

const BOTTOM_KEYWORDS = [
  "bottom",
  "bottoms",
  "bas",
  "lower body",
];

export function mapRequestedGarmentCategory(
  raw?: string,
): GarmentCategory | null {
  const text = normalizeToken(raw ?? "");
  if (!text) return null;
  if (containsAny(text, ["t shirt", "tshirt", "tshirts", "tee", "tees"])) {
    return "tshirts";
  }
  if (containsAny(text, ["shirt", "shirts", "chemise", "chemises"])) {
    return "shirts";
  }
  if (containsAny(text, ["hoodie", "hoodies", "sweatshirt", "sweatshirts"])) {
    return "hoodies";
  }
  if (
    containsAny(text, [
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
    ])
  ) {
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
      "body guide",
      "body measurement",
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
  if (text === "int" || text === "international") return "INT";
  if (text === "eu" || text === "europe" || text === "european") return "EU";
  if (text === "fr" || text === "france" || text === "francais") return "FR";
  if (text === "us" || text === "usa" || text === "american") return "US";
  if (text === "uk" || text === "british") return "UK";
  if (text === "it" || text === "italy" || text === "italian") return "IT";
  if (text === "waist inseam" || text === "waist_inseam") {
    return "WAIST_INSEAM";
  }
  if (text === "footwear" || text === "shoe size") return "FOOTWEAR";
  if (text === "bra") return "BRA";
  return null;
}

export function detectAudience(text: string): Audience {
  const normalized = normalizeToken(text);
  if (containsAny(normalized, ["kid", "kids", "child", "children", "junior", "boys", "girls"])) {
    return "kids";
  }
  if (containsAny(normalized, ["unisex"])) return "unisex";
  if (containsAny(normalized, ["women", "woman", "female", "femme", "femmes", "lady", "ladies"])) {
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
  if (normalized) return "standard";
  return "unknown";
}

export function isSizeLikeLabel(label: string): boolean {
  const normalized = normalizeToken(label);
  if (!normalized) return false;
  if (/^(xxs|xs|s|m|l|xl|xxl|xxxl|3xl|4xl|5xl)( tall| petite| regular)?$/.test(normalized)) {
    return true;
  }
  if (/^\d{2,3}(\/\d{2,3})?( tall| petite| regular)?$/.test(normalized)) {
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
    .replace(/\b(tall|petite|regular|long)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  const canonicalLabel = stripped || label.trim().toUpperCase();
  return {
    canonicalLabel,
    fitVariant: fitVariant === "unknown" ? "standard" : fitVariant,
  };
}

export function detectSizeSystem(args: {
  rowLabels: string[];
  headers: string[];
  context: string;
}): DetectedSizeSystem {
  const context = normalizeToken(
    [...args.headers, ...args.rowLabels, args.context].join(" "),
  );
  const rowLabels = args.rowLabels.map((label) => normalizeToken(label));

  if (rowLabels.some((label) => /^(xxs|xs|s|m|l|xl|xxl|xxxl|3xl|4xl|5xl)/.test(label))) {
    return "INT";
  }
  if (rowLabels.some((label) => /^w\d+\s*l\d+$/.test(label) || /^\d{2,3}\/\d{2,3}$/.test(label))) {
    return "WAIST_INSEAM";
  }
  if (containsAny(context, ["footwear", "shoe size", "chaussure", "shoes"])) {
    return "FOOTWEAR";
  }
  if (containsAny(context, ["bra", "cup size"])) {
    return "BRA";
  }
  if (containsAny(context, [" us ", " us size", " size us"])) return "US";
  if (containsAny(context, [" uk ", " uk size", " size uk"])) return "UK";
  if (containsAny(context, [" eu ", " eu size", " size eu"])) return "EU";
  if (containsAny(context, [" fr ", " fr size", " size fr"])) return "FR";
  if (containsAny(context, [" it ", " it size", " size it"])) return "IT";
  if (rowLabels.length > 0 && rowLabels.every((label) => /^\d{2,3}([ -]\d{2,3})?$/.test(label))) {
    return "NUMERIC";
  }
  return "UNKNOWN";
}

export function detectCategory(args: {
  sectionTitle: string;
  subheading?: string;
  headers: string[];
  rowLabels: string[];
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
    args.nearbyText,
  ];
  const text = normalizeToken(labelSources.join(" "));
  const reasons: string[] = [];
  const hasChest = args.fields.includes("chest");
  const hasInseam = args.fields.includes("inseam");
  const hasFoot = args.fields.includes("footLength") || args.fields.includes("footWidth");

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
    containsAny(text, [
      "body measurement",
      "body guide",
      "guide des mesures",
      "size advice",
      "fit advice",
      "how to measure",
    ])
  ) {
    reasons.push("Section is labeled as body guidance or size advice.");
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

  if (
    containsAny(text, [
      "t shirt",
      "tshirts",
      "tshirt",
      "tee",
      "tees",
    ])
  ) {
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

  if (
    containsAny(text, [
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
    ])
  ) {
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
