import { parseRangeCm } from "@/lib/normalizers/units";
import type { MeasurementField, MeasurementUnit, SizeRow } from "@/lib/types";

export const FIELD_TO_ROW_KEYS: Record<
  MeasurementField,
  [keyof SizeRow, keyof SizeRow]
> = {
  chest: ["chestCmMin", "chestCmMax"],
  waist: ["waistCmMin", "waistCmMax"],
  hips: ["hipsCmMin", "hipsCmMax"],
  inseam: ["inseamCmMin", "inseamCmMax"],
  outseam: ["outseamCmMin", "outseamCmMax"],
  height: ["heightCmMin", "heightCmMax"],
  sleeve: ["sleeveCmMin", "sleeveCmMax"],
  neck: ["neckCmMin", "neckCmMax"],
  shoulder: ["shoulderCmMin", "shoulderCmMax"],
  footLength: ["footLengthCmMin", "footLengthCmMax"],
  footWidth: ["footWidthCmMin", "footWidthCmMax"],
};

const FIELD_PATTERNS: Array<{ field: MeasurementField; pattern: RegExp }> = [
  { field: "chest", pattern: /(chest|bust|poitrine|tour de poitrine)/i },
  { field: "waist", pattern: /(waist|taille\b|tour de taille)/i },
  { field: "hips", pattern: /(hip|hips|hanche|hanches|tour de hanche)/i },
  { field: "inseam", pattern: /(inseam|inside leg|entrejambe)/i },
  { field: "outseam", pattern: /(outseam|outside leg)/i },
  { field: "height", pattern: /(height|stature|hauteur|taille corporelle|torso|body length|front length|back length|garment length)/i },
  { field: "sleeve", pattern: /(sleeve|manche)/i },
  { field: "neck", pattern: /(neck|collar|encolure|cou)/i },
  { field: "shoulder", pattern: /(shoulder|epaule|epaules|épaule|épaules)/i },
  { field: "footLength", pattern: /(foot length|length of foot|longueur du pied|pied)/i },
  { field: "footWidth", pattern: /(foot width|largeur du pied)/i },
];

export function fieldFromHeader(header: string): MeasurementField | null {
  for (const candidate of FIELD_PATTERNS) {
    if (candidate.pattern.test(header)) {
      return candidate.field;
    }
  }
  return null;
}

export function detectFields(headers: string[]): MeasurementField[] {
  return headers
    .map((header) => fieldFromHeader(header))
    .filter((field): field is MeasurementField => Boolean(field));
}

export function detectMeasurementUnit(text: string): MeasurementUnit {
  const lower = text.toLowerCase();
  const hasCm = /\b(cm|centim)/i.test(lower);
  const hasIn = /\b(inch|inches)\b|\(\s*in\s*\)|\bin\.|"/i.test(lower);
  if (hasCm && hasIn) return "mixed";
  if (hasCm) return "cm";
  if (hasIn) return "in";
  return "unknown";
}

function resolveCellUnit(
  raw: string,
  header: string,
  fallback: MeasurementUnit,
): "cm" | "in" {
  const detected = detectMeasurementUnit(`${header} ${raw}`);
  if (detected === "cm" || detected === "in") return detected;
  if (fallback === "in") return "in";
  return "cm";
}

export function parseMeasurementCell(
  raw: string,
  header: string,
  fallback: MeasurementUnit,
): [number, number] | null {
  const unit = resolveCellUnit(raw, header, fallback);
  return parseRangeCm(raw, unit);
}
