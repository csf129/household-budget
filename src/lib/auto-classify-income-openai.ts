/**
 * Server-only: OpenAI decides whether positive amounts are real overview income.
 */

export type IncomeTxContext = {
  id: string;
  raw_description: string;
  normalized_description: string;
  amount: number;
};

export type IncomeLlmAssignment = {
  transactionId: string;
  treatment: "include" | "exclude" | "neutral";
};

const BATCH_SIZE = 28;

function buildUserPayload(transactions: IncomeTxContext[]): string {
  const lines = transactions.map((t) => {
    return `- id=${t.id} amount=${t.amount} description="${t.raw_description.replace(/"/g, "'").slice(0, 400)}"`;
  });
  return `Each row is a positive (credit) transaction from a bank or card export.

For each id, choose exactly one:
- "include" = count as real household income on an overview (payroll, interest, rental income, gifts received, tax refunds meant as income, etc.).
- "exclude" = do NOT count as overview income (credit card refunds, purchase returns, charge reversals, cash-back rewards, balance transfers, duplicate-looking credits, internal bank adjustments that are not new money).
- "neutral" = unsure or mixed; leave the app default (do not change stored override).

Transactions:\n${lines.join("\n")}

Return JSON: {"assignments":[{"transactionId":"<uuid>","treatment":"include"|"exclude"|"neutral"}]}
Include every transaction id exactly once.`;
}

export async function fetchIncomeClassificationsFromOpenAI(
  apiKey: string,
  transactions: IncomeTxContext[],
): Promise<IncomeLlmAssignment[]> {
  if (transactions.length === 0) return [];

  const all: IncomeLlmAssignment[] = [];

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    const content = buildUserPayload(batch);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You classify bank transactions for a household budget overview. Reply with compact JSON only. treatment must be include, exclude, or neutral.",
          },
          { role: "user", content },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `OpenAI request failed (${res.status}): ${errText.slice(0, 500)}`,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("Empty response from OpenAI.");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        parsed = JSON.parse(raw.slice(start, end + 1));
      } else {
        throw new Error("Model did not return valid JSON.");
      }
    }

    const assignments = (parsed as { assignments?: unknown }).assignments;
    if (!Array.isArray(assignments)) {
      throw new Error('Expected JSON with an "assignments" array.');
    }

    for (const row of assignments) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const transactionId =
        typeof r.transactionId === "string" ? r.transactionId : null;
      const t = r.treatment;
      const treatment =
        t === "include" || t === "exclude" || t === "neutral" ? t : null;
      if (transactionId && treatment) {
        all.push({ transactionId, treatment });
      }
    }
  }

  return all;
}

export function validateIncomeAssignments(
  assignments: IncomeLlmAssignment[],
  allowedTxIds: Set<string>,
): Map<string, "include" | "exclude"> {
  const out = new Map<string, "include" | "exclude">();
  for (const a of assignments) {
    if (!allowedTxIds.has(a.transactionId)) continue;
    if (a.treatment === "neutral") continue;
    out.set(a.transactionId, a.treatment);
  }
  return out;
}
