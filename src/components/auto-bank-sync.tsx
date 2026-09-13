"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Fires a background Plaid sync when the app is opened so transactions stay
 * fresh without the user clicking "Sync bank transactions". Mounted once in the
 * app layout, so it runs on full page loads.
 *
 * Throttled on both ends: a module-level timestamp skips refiring during a
 * single SPA session, and the server skips connections synced in the last few
 * minutes (see the `auto` branch in /api/plaid/sync-transactions). The UI is
 * only refreshed when the sync actually changed something.
 */
const CLIENT_THROTTLE_MS = 2 * 60 * 1000;
let lastAttemptMs = 0;

export function AutoBankSync() {
  const router = useRouter();

  useEffect(() => {
    const now = Date.now();
    if (now - lastAttemptMs < CLIENT_THROTTLE_MS) return;
    lastAttemptMs = now;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/plaid/sync-transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auto: true }),
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          skipped?: boolean;
          upserted?: number;
          removed?: number;
          ledger_replaced?: number;
          categorized?: number;
        };
        if (cancelled || data.skipped) return;
        const changed =
          (data.upserted ?? 0) > 0 ||
          (data.removed ?? 0) > 0 ||
          (data.ledger_replaced ?? 0) > 0 ||
          (data.categorized ?? 0) > 0;
        if (changed) router.refresh();
      } catch {
        // Background best-effort — stay silent; the manual Sync button surfaces errors.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
