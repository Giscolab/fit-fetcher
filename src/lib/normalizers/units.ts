/** Unit normalization helpers. */

export type Unit = "cm" | "in" | "unknown";

const IN_TO_CM = 2.54;

/** Detect the unit used in a free-form string. */
export function detectUnit(text: string): Unit {
  const t = text.toLowerCase();
  if (/\b(cm|centim)/i.test(t)) return "cm";
  if (/\b(inch|inches)\b|\(\s*in\s*\)|\bin\.|"/i.test(t)) return "in";
  return "unknown";
}

/** Convert a numeric value to cm given the source unit. */
export function toCm(value: number, unit: Unit): number {
  if (unit === "in") return Math.round(value * IN_TO_CM * 10) / 10;
  return Math.round(value * 10) / 10;
}

function parseNumberPhrase(raw: string): number | null {
  const cleaned = raw
    .replace(/[“”"]/g, "")
    .replace(/\b(?:cm|centimeters?|centimetres?|in|inch|inches)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const mixed = cleaned.match(/^(-?\d+(?:[.,]\d+)?)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number.parseFloat(mixed[1].replace(",", "."));
    const numerator = Number.parseInt(mixed[2], 10);
    const denominator = Number.parseInt(mixed[3], 10);
    if (!Number.isNaN(whole) && denominator > 0) {
      return whole + numerator / denominator;
    }
  }

  const fraction = cleaned.match(/^(-?\d+)\/(\d+)$/);
  if (fraction) {
    const numerator = Number.parseInt(fraction[1], 10);
    const denominator = Number.parseInt(fraction[2], 10);
    return denominator > 0 ? numerator / denominator : null;
  }

  const decimal = cleaned.match(/-?\d+(?:[.,]\d+)?/);
  if (!decimal) return null;
  const value = Number.parseFloat(decimal[0].replace(",", "."));
  return Number.isNaN(value) ? null : value;
}

function parseFeetInches(raw: string): [number, number] | null {
  const heightToken = /(\d+)\s*'\s*(\d+(?:[.,]\d+)?)?/g;
  const values: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = heightToken.exec(raw))) {
    const feet = Number.parseInt(match[1], 10);
    const inches = match[2] ? Number.parseFloat(match[2].replace(",", ".")) : 0;
    if (!Number.isNaN(feet) && !Number.isNaN(inches)) {
      values.push(feet * 12 + inches);
    }
  }

  if (values.length >= 2) return [Math.min(values[0], values[1]), Math.max(values[0], values[1])];
  if (values.length === 1) return [values[0], values[0]];
  return null;
}

/**
 * Parse a numeric token or range like "88", "88-96", "88–96",
 * "32 1/2–34" or "5'7\" - 6'0\"", returning [min, max] in the
 * original unit.
 */
export function parseRange(raw: string): [number, number] | null {
  if (!raw) return null;
  const feetInches = parseFeetInches(raw);
  if (feetInches) return feetInches;

  const cleaned = raw
    .replace(/\u00a0/g, " ")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(/\s*(?:-|–|—|\bto\b|\bà\b|\ba\b)\s*/i).filter(Boolean);

  if (parts.length >= 2) {
    const a = parseNumberPhrase(parts[0]);
    const b = parseNumberPhrase(parts[1]);
    if (a !== null && b !== null) return [Math.min(a, b), Math.max(a, b)];
  }

  const single = parseNumberPhrase(cleaned);
  return single === null ? null : [single, single];
}

/** Parse + convert to cm in one go. */
export function parseRangeCm(raw: string, unit: Unit): [number, number] | null {
  const r = parseRange(raw);
  if (!r) return null;
  return [toCm(r[0], unit), toCm(r[1], unit)];
}
