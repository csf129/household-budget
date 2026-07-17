import { callAi } from "@/lib/call-ai";
import { DEFAULT_AI_MODEL_ID } from "@/lib/ai-models";

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
  return `Household categories (pick categoryId only from this list):\n${catLines.join("\n")}\n\nTransactions to categorize:\n${txLines.join("\n")}\n\nReturn JSON: {"assignments":[{"transactionId":"<uuid>","categoryId":"<uuid from the list above>"}]}\nOnly include transactions you can confidently assign. Omit any transaction you cannot match — do NOT use null.`;
}

export type LlmAssignment = { transactionId: string; categoryId: string | null };

export async function fetchAssignmentsFromOpenAI(
  _apiKey: string,
  categories: CategoryContext[],
  transactions: TransactionContext[],
  modelId?: string,
): Promise<LlmAssignment[]> {
  if (transactions.length === 0) return [];
  if (categories.length === 0) {
    throw new Error("No categories available to assign.");
  }

  const model = modelId ?? DEFAULT_AI_MODEL_ID;
  const all: LlmAssignment[] = [];

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    const content = buildUserPayload(categories, batch);

    const raw = await callAi({
      modelId: model,
      temperature: 0.1,
      maxTokens: 4096,
      jsonMode: true,
      messages: [
        {
          role: "system",
          content:
            "You categorize personal finance transactions. Reply with compact JSON only. categoryId must be one of the provided category ids — never null, never invented.",
        },
        { role: "user", content },
      ],
    });

    if (!raw) throw new Error("Empty response from AI.");

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
