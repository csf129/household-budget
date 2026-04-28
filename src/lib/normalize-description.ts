/**
 * Normalizes bank/card descriptions for matching rules (stable key per "same merchant" line).
 */
export function normalizeDescription(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
