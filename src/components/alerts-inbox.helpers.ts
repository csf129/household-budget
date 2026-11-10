/**
 * Helpers extracted from alerts-inbox.tsx. The read-state helpers touch
 * localStorage (guarded); the formatters are pure.
 */

const READ_KEY_PREFIX = "alerts-read:";

export function readStoredIds(householdId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(`${READ_KEY_PREFIX}${householdId}`);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function saveReadIds(householdId: string, ids: Set<string>) {
  try {
    window.localStorage.setItem(
      `${READ_KEY_PREFIX}${householdId}`,
      JSON.stringify([...ids]),
    );
  } catch { /* ignore */ }
}

export function formatAlertDate(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

/** Currency of the magnitude (always non-negative) — alerts show "$120 up", etc. */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.abs(amount));
}
