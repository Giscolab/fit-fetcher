export const GARMENT_CATEGORIES = [
  "tshirt", "polo", "chemise", "pull", "hoodie", "veste_legere", "manteau",
  "jean", "pantalon", "chino", "cargo", "short", "boxer", "slip", "chaussette",
  "parka", "doudoune", "boxers_or_underwear", "socks", "tshirts", "shirts",
  "sweaters", "hoodies", "jackets", "coats", "jeans", "trousers", "shorts",
] as const;
export type GarmentCategory = (typeof GARMENT_CATEGORIES)[number];

export const SIZE_SYSTEMS = [
  "FR", "EU", "US", "UK", "IT", "INT", "WAIST_INSEAM", "FOOTWEAR", "SOCK",
] as const;
export type SizeSystem = (typeof SIZE_SYSTEMS)[number];

export interface BrandSource {
  brand: string;
  name?: string;
  size_guide_url: string;
  garmentCategory?: GarmentCategory;
  sizeSystem?: SizeSystem;
}

export interface SizeRow {
  label: string;
  chestCmMin?: number;
  chestCmMax?: number;
  waistCmMin?: number;
  waistCmMax?: number;
  hipsCmMin?: number;
  hipsCmMax?: number;
  inseamCmMin?: number;
  inseamCmMax?: number;
  neckCmMin?: number;
  neckCmMax?: number;
  shoulderCmMin?: number;
  shoulderCmMax?: number;
  sleeveCmMin?: number;
  sleeveCmMax?: number;
  footCmMin?: number;
  footCmMax?: number;
}

export interface Brand {
  id: string;
  name: string;
  country: string | null;
  website: string | null;
  isSample: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Guide {
  id: string;
  brandId: string;
  name: string;
  garmentCategory: GarmentCategory;
  sizeSystem: SizeSystem;
  fabricStretch: "low" | "medium" | "high";
  rows: SizeRow[];
}

export interface GeneratedGuide {
  brand: Brand;
  guide: Guide;
}

export type BrandStatus = "pending" | "running" | "done" | "error";

export interface BrandResult {
  source: BrandSource;
  status: BrandStatus;
  message?: string;
  rowsCount?: number;
  guide?: GeneratedGuide;
  logs: string[];
}
