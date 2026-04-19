/** Unit normalization helpers. */

export type Unit = "cm" | "in" | "unknown";

const IN_TO_CM = 2.54;

/** Detect the unit used in a free-form string. */
export function detectUnit(text: string): Unit {
  const t = text.toLowerCase();
  if (/\b(cm|centim)/i.test(t)) return "cm";
  if (/\b(in|inch|inches|")/i.test(t)) return "in";
  return "unknown";
}

/** Convert a numeric value to cm given the source unit. */
export function toCm(value: number, unit: Unit): number {
  if (unit === "in") return Math.round(value * IN_TO_CM * 10) / 10;
  return Math.round(value * 10) / 10;
}

/**
 * Parse a numeric token or range like "88", "88-96", "88–96", "34 1/2",
 * returning [min, max] in the original unit.
 */
export function parseRange(raw: string): [number, number] | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, " ").replace(/[""']/g, "").trim();
  // range: 88-96 / 88–96 / 88 to 96
  const rangeMatch = cleaned.match(
    /(-?\d+(?:[.,]\d+)?)\s*(?:-|–|—|to|à|a)\s*(-?\d+(?:[.,]\d+)?)/i,
  );
  if (rangeMatch) {
    const a = parseFloat(rangeMatch[1].replace(",", "."));
    const b = parseFloat(rangeMatch[2].replace(",", "."));
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      return [Math.min(a, b), Math.max(a, b)];
    }
  }
  // single number with optional fraction: 34 1/2
  const fractionMatch = cleaned.match(/(-?\d+)\s+(\d+)\/(\d+)/);
  if (fractionMatch) {
    const whole = parseInt(fractionMatch[1], 10);
    const num = parseInt(fractionMatch[2], 10);
    const den = parseInt(fractionMatch[3], 10);
    if (den) {
      const v = whole + num / den;
      return [v, v];
    }
  }
  const single = cleaned.match(/-?\d+(?:[.,]\d+)?/);
  if (single) {
    const v = parseFloat(single[0].replace(",", "."));
    if (!Number.isNaN(v)) return [v, v];
  }
  return null;
}

/** Parse + convert to cm in one go. */
export function parseRangeCm(raw: string, unit: Unit): [number, number] | null {
  const r = parseRange(raw);
  if (!r) return null;
  return [toCm(r[0], unit), toCm(r[1], unit)];
}
