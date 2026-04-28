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
export async function requestClassifyIncome(
  transactionIds?: string[],
  options?: { onlyUnset?: boolean },
): Promise<ClassifyIncomeResult> {
  const res = await fetch("/api/household/classify-income", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionIds:
        transactionIds && transactionIds.length > 0 ? transactionIds : undefined,
      onlyUnset: options?.onlyUnset !== false,
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
