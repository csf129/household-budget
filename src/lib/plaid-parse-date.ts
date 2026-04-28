/** Plaid YYYY-MM-DD from API date fields. */
export function parsePlaidDate(s: string | null | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  const m = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(m) ? m : null;
}
