/**
 * Server-only: calls OpenAI to map transaction descriptions to category IDs.
 * Requires OPENAI_API_KEY in the environment.
 */

export type CategoryContext = {
  id: string;
  name: string;
  description: string | null;
};

export type TransactionContext = {
  id: string;
  raw_description: string;
  normalized_description: string;
  amount: number;
};

const BATCH_SIZE = 28;

function buildUserPayload(
  categories: CategoryContext[],
  transactions: TransactionContext[],
): string {
  const catLines = categories.map(
    (c) =>
      `- id=${c.id} name="${c.name.replace(/"/g, "'")}"${c.description ? ` notes: ${c.description.slice(0, 200)}` : ""}`,
  );
  const txLines = transactions.map((t) => {
    const flow = t.amount >= 0 ? "income" : "expense";
    return `- id=${t.id} ${flow} amount=${t.amount} description="${t.raw_description.replace(/"/g, "'").slice(0, 400)}"`;
  });
  return `Household categories (pick categoryId only from this list):\n${catLines.join("\n")}\n\nTransactions to categorize:\n${txLines.join("\n")}\n\nReturn JSON: {"assignments":[{"transactionId":"<uuid>","categoryId":"<uuid of best category or null if none fits>"}]}\nInclude every transaction id exactly once. Use null when no category is a reasonable fit.`;
}

export type LlmAssignment = { transactionId: string; categoryId: string | null };

export async function fetchAssignmentsFromOpenAI(
  apiKey: string,
  categories: CategoryContext[],
  transactions: TransactionContext[],
): Promise<LlmAssignment[]> {
  if (transactions.length === 0) return [];
  if (categories.length === 0) {
    throw new Error("No categories available to assign.");
  }

  const all: LlmAssignment[] = [];

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    const content = buildUserPayload(categories, batch);

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
              "You categorize personal finance transactions. Reply with compact JSON only. categoryId must be one of the provided category ids or null.",
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
      const categoryId =
        r.categoryId === null || r.categoryId === undefined
          ? null
          : typeof r.categoryId === "string"
            ? r.categoryId
            : null;
      if (transactionId) {
        all.push({ transactionId, categoryId });
      }
    }
  }

  return all;
}

export function validateAndDedupeAssignments(
  assignments: LlmAssignment[],
  allowedTxIds: Set<string>,
  allowedCategoryIds: Set<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of assignments) {
    if (!allowedTxIds.has(a.transactionId)) continue;
    if (a.categoryId == null || a.categoryId === "") continue;
    if (!allowedCategoryIds.has(a.categoryId)) continue;
    out.set(a.transactionId, a.categoryId);
  }
  return out;
}
