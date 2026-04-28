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
export async function requestAutoCategorize(
  transactionIds?: string[],
): Promise<AutoCategorizeResult> {
  const res = await fetch("/api/household/auto-categorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionIds:
        transactionIds && transactionIds.length > 0 ? transactionIds : undefined,
      onlyUncategorized: true,
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;

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
