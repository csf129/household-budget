export type AutoCategorizeResult =
  | {
      ok: true;
      updated: number;
      considered?: number;
      message?: string;
    }
  | {
      ok: false;
      code?: string;
      error: string;
      updated?: number;
    };

/**
 * Calls the server to assign categories via OpenAI for the given transactions
 * (must belong to your household and typically be uncategorized).
 * If `transactionIds` is omitted or empty, categorizes up to 100 uncategorized rows.
 */
/** Abort a single round after this long so a hung request fails cleanly
 * instead of leaving the caller stuck "Analyzing…" forever. The server route
 * caps itself at 60s (maxDuration), so give it a little headroom. */
const REQUEST_TIMEOUT_MS = 70_000;

export async function requestAutoCategorize(
  transactionIds?: string[],
  options?: { tolerateMissing?: boolean },
): Promise<AutoCategorizeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch("/api/household/auto-categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        transactionIds:
          transactionIds && transactionIds.length > 0
            ? transactionIds
            : undefined,
        onlyUncategorized: true,
        // In bulk mode the caller enumerates ids from a client-side snapshot;
        // tolerate ids that were categorized meanwhile instead of failing the batch.
        tolerateMissing: options?.tolerateMissing === true,
      }),
    });
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof DOMException && e.name === "AbortError"
          ? "AI categorization timed out. Try again."
          : e instanceof Error
            ? e.message
            : "Network error contacting the server.",
    };
  } finally {
    clearTimeout(timeout);
  }

  // A platform 504/500 can return HTML, not JSON; don't let .json() throw.
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    if (!res.ok) {
      return {
        ok: false,
        error: `Server error (${res.status} ${res.statusText || "unexpected response"}).`,
      };
    }
  }

  if (res.ok) {
    return {
      ok: true,
      updated: Number(data.updated ?? 0),
      considered:
        data.considered !== undefined ? Number(data.considered) : undefined,
      message: typeof data.message === "string" ? data.message : undefined,
    };
  }

  return {
    ok: false,
    code: typeof data.code === "string" ? data.code : undefined,
    error: typeof data.error === "string" ? data.error : res.statusText,
    updated:
      typeof data.updated === "number" ? data.updated : undefined,
  };
}
