import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiTool } from "@/lib/call-ai";
import { withActiveLedgerOnly } from "@/lib/ledger-archive-schema";

type AmountSign = "spend" | "income" | "all";
type GroupBy = "month" | "category" | "merchant" | "none";

/** Raw transaction shape pulled for aggregation (categories relation is defensive). */
type TxRow = {
  amount: number | string | null;
  occurred_on: string | null;
  raw_description: string | null;
  normalized_description: string | null;
  categories:
    | { name?: string | null }
    | Array<{ name?: string | null }>
    | null;
};

type GroupResult = { bucket: string; total: number; count: number };

type QuerySpendingResult =
  | { error: string }
  | {
      date_from: string;
      date_to: string;
      amount_sign: AmountSign;
      group_by: GroupBy;
      /** For spend/income: positive dollars. For "all": net (income − spend), signed. */
      grand_total: number;
      transaction_count: number;
      groups: GroupResult[];
      /** True when the scan hit the row cap and totals may be incomplete. */
      truncated: boolean;
    };

/** Max transactions scanned per query; guards against pathological ranges. */
const MAX_SCAN_ROWS = 20000;
const PAGE = 1000;
/** Cap the number of buckets returned to the model to keep the payload small. */
const MAX_GROUPS = 100;

function parseAmount(raw: number | string | null): number {
  const n = typeof raw === "string" ? Number.parseFloat(raw) : Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter((s) => s.length > 0);
}

function isoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function categoryName(categories: TxRow["categories"]): string {
  if (!categories) return "Uncategorized";
  const rel = Array.isArray(categories) ? categories[0] : categories;
  const name = rel && typeof rel === "object" ? rel.name : null;
  const s = typeof name === "string" ? name.trim() : "";
  return s.length > 0 ? s : "Uncategorized";
}

async function runQuerySpending(
  supabase: SupabaseClient,
  householdId: string,
  hasLedgerArchive: boolean,
  input: Record<string, unknown>,
): Promise<QuerySpendingResult> {
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const dateFrom = isoDate(input.date_from) ?? oneYearAgo.toISOString().slice(0, 10);
  const dateTo = isoDate(input.date_to) ?? today.toISOString().slice(0, 10);
  const descNeedles = toStringArray(input.description_contains).map((s) => s.toLowerCase());
  const catNeedles = toStringArray(input.category_names).map((s) => s.toLowerCase());
  const amountSign: AmountSign =
    input.amount_sign === "income" || input.amount_sign === "all" ? input.amount_sign : "spend";
  const groupBy: GroupBy =
    input.group_by === "category" ||
    input.group_by === "merchant" ||
    input.group_by === "none"
      ? input.group_by
      : "month";

  const rows: TxRow[] = [];
  let truncated = false;
  for (let offset = 0; offset < MAX_SCAN_ROWS; offset += PAGE) {
    const { data, error } = await withActiveLedgerOnly(
      supabase
        .from("transactions")
        .select("amount, occurred_on, raw_description, normalized_description, categories(name)")
        .eq("household_id", householdId)
        .gte("occurred_on", dateFrom)
        .lte("occurred_on", dateTo)
        .order("occurred_on", { ascending: true })
        .range(offset, offset + PAGE - 1),
      hasLedgerArchive,
    );
    if (error) return { error: error.message };
    const batch = (data ?? []) as unknown as TxRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (offset + PAGE >= MAX_SCAN_ROWS) truncated = true;
  }

  const buckets = new Map<string, { total: number; count: number }>();
  let grandTotal = 0;
  let count = 0;

  for (const t of rows) {
    const amt = parseAmount(t.amount);
    if (!Number.isFinite(amt) || amt === 0) continue;

    // amount_sign filter
    if (amountSign === "spend" && amt >= 0) continue;
    if (amountSign === "income" && amt <= 0) continue;

    // description filter (OR across needles, matched on raw + normalized)
    if (descNeedles.length > 0) {
      const hay = `${t.raw_description ?? ""} ${t.normalized_description ?? ""}`.toLowerCase();
      if (!descNeedles.some((n) => hay.includes(n))) continue;
    }

    // category filter (OR across needles, substring on category name)
    const cat = categoryName(t.categories);
    if (catNeedles.length > 0) {
      const catLower = cat.toLowerCase();
      if (!catNeedles.some((n) => catLower.includes(n))) continue;
    }

    // Contribution: spend/income report positive dollars; "all" is signed net.
    const contribution =
      amountSign === "spend" ? Math.abs(amt) : amountSign === "income" ? amt : amt;

    let bucket: string;
    if (groupBy === "month") bucket = String(t.occurred_on ?? "").slice(0, 7) || "unknown";
    else if (groupBy === "category") bucket = cat;
    else if (groupBy === "merchant")
      bucket =
        (t.normalized_description || t.raw_description || "Unknown").trim() || "Unknown";
    else bucket = "total";

    const entry = buckets.get(bucket) ?? { total: 0, count: 0 };
    entry.total += contribution;
    entry.count += 1;
    buckets.set(bucket, entry);

    grandTotal += contribution;
    count += 1;
  }

  const groups: GroupResult[] = [...buckets.entries()].map(([bucket, v]) => ({
    bucket,
    total: round2(v.total),
    count: v.count,
  }));
  // Month buckets read best chronologically; everything else by size desc.
  if (groupBy === "month") groups.sort((a, b) => a.bucket.localeCompare(b.bucket));
  else groups.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  return {
    date_from: dateFrom,
    date_to: dateTo,
    amount_sign: amountSign,
    group_by: groupBy,
    grand_total: round2(grandTotal),
    transaction_count: count,
    groups: groups.slice(0, MAX_GROUPS),
    truncated,
  };
}

const QUERY_SPENDING_SPEC = {
  name: "query_spending",
  description:
    "Query the household's full transaction history to build spending or income reports. " +
    "Use this for ANY specific or analytical question — a particular merchant, category, or " +
    "time period, or a per-month / per-category breakdown — especially anything beyond the " +
    "90-day summary already in context. For a concept that has no category of its own " +
    "(e.g. streaming services, rideshare, fast food, coffee), pass the well-known merchant " +
    "names in description_contains, e.g. [\"netflix\",\"spotify\",\"hulu\",\"disney\",\"hbo\",\"max\"]. " +
    "amount_sign=spend and income return positive dollar totals; amount_sign=all returns a " +
    "signed net (income minus spend). Prefer these results over the summary when they differ.",
  inputSchema: {
    type: "object" as const,
    properties: {
      date_from: {
        type: "string",
        description: "Inclusive start date, YYYY-MM-DD. Defaults to one year ago.",
      },
      date_to: {
        type: "string",
        description: "Inclusive end date, YYYY-MM-DD. Defaults to today.",
      },
      description_contains: {
        type: "array",
        items: { type: "string" },
        description:
          "Case-insensitive substrings matched against the transaction description (OR). " +
          "Use to capture merchants for a concept without its own category.",
      },
      category_names: {
        type: "array",
        items: { type: "string" },
        description: "Case-insensitive substrings matched against the category name (OR).",
      },
      amount_sign: {
        type: "string",
        enum: ["spend", "income", "all"],
        description: "spend = money out, income = money in, all = net. Defaults to spend.",
      },
      group_by: {
        type: "string",
        enum: ["month", "category", "merchant", "none"],
        description: "How to bucket the totals. Defaults to month.",
      },
    },
  },
};

/**
 * Tools the in-app budget assistant can call. Scoped to a single household and
 * the user's RLS context (the passed Supabase client). Pure reads — no mutations.
 */
export function createAssistantTools(
  supabase: SupabaseClient,
  householdId: string,
  hasLedgerArchive: boolean,
): AiTool[] {
  return [
    {
      spec: QUERY_SPENDING_SPEC,
      run: (input) => runQuerySpending(supabase, householdId, hasLedgerArchive, input),
    },
  ];
}
