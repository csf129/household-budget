export type ClassifyIncomeResult =
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
 * Uses OpenAI to set per-transaction income_treatment (include/exclude) for
 * overview charts. Targets positive amounts; default body onlyUnset: true.
 */
/** Abort a single request after this long so a hung call fails cleanly
 * instead of leaving the caller stuck "Tagging…" forever. The server route
 * caps itself at 60s (maxDuration), so give it a little headroom. */
const REQUEST_TIMEOUT_MS = 70_000;

export async function requestClassifyIncome(
  transactionIds?: string[],
  options?: { onlyUnset?: boolean },
): Promise<ClassifyIncomeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch("/api/household/classify-income", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        transactionIds:
          transactionIds && transactionIds.length > 0
            ? transactionIds
            : undefined,
        onlyUnset: options?.onlyUnset !== false,
      }),
    });
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof DOMException && e.name === "AbortError"
          ? "AI income tagging timed out. Try again."
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
