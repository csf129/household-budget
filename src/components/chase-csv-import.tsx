"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  resolveCategoryFromRules,
  type CategoryRuleRow,
} from "@/lib/apply-category-rules";
import {
  resolveIncomeTreatmentFromRules,
  type IncomeRuleRow,
} from "@/lib/apply-income-rules";
import {
  applyDescriptionRules,
  buildDescriptionRuleMap,
} from "@/lib/apply-description-rules";
import {
  matchChaseCategoryToId,
  resolveCategoryIdByCanonicalName,
} from "@/lib/chase-category-match";
import { descriptionExcludedFromOverviewAsCardPayment } from "@/lib/detect-credit-card-payment-description";
import type { BankCsvImportRow } from "@/lib/bank-csv-types";
import { requestAutoCategorize } from "@/lib/auto-categorize-client";
import {
  parseBankExportCsv,
  type BankExportFormat,
} from "@/lib/parse-bank-export-csv";
import { fetchExistingImportDedupeKeys } from "@/lib/fetch-existing-import-dedupe-keys";
import { formatUsd } from "@/lib/money";
import { transactionImportDedupeKey } from "@/lib/transaction-import-dedupe-key";
import type { AccountRow, CategoryRow } from "@/types/finance";

const INSERT_CHUNK = 120;

const CREDIT_CARD_PAYMENT_CATEGORY = "credit card payment";

type Props = {
  householdId: string;
  userId: string;
  categories: CategoryRow[];
  accounts: AccountRow[];
  /** Required for import when `accounts` is non-empty. */
  importAccountId: string;
  /** When true, omit outer card styling (e.g. inside a dialog). */
  embedded?: boolean;
  /** When true, omit the main heading (parent dialog provides the title). */
  suppressHeading?: boolean;
};

function formatSourceLabel(format: BankExportFormat): string {
  if (format === "chase") return "Chase";
  if (format === "boa") return "Bank of America";
  return "Unknown";
}

export function TransactionCsvImport({
  householdId,
  userId,
  categories,
  accounts,
  importAccountId,
  embedded = false,
  suppressHeading = false,
}: Props) {
  const router = useRouter();
  const [parsed, setParsed] = useState<BankCsvImportRow[] | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<BankExportFormat>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setParsed(null);
    setDetectedFormat(null);
    setParseErrors([]);
    setFileLabel(null);
    setStatus(null);
    setImportError(null);
  }, []);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    reset();
    if (!file) return;
    setFileLabel(file.name);
    const text = await file.text();
    const result = parseBankExportCsv(text);
    setParseErrors(result.errors);
    setDetectedFormat(result.format);
    setParsed(result.rows.length > 0 ? result.rows : null);
    if (result.rows.length === 0 && result.errors.length === 0) {
      setParseErrors(["No rows could be parsed."]);
    }
  }

  async function runImport() {
    if (!parsed || parsed.length === 0) return;
    if (accounts.length > 0 && !importAccountId.trim()) {
      setImportError(
        "Choose which account this file is for (use the account selector in this window).",
      );
      return;
    }
    setBusy(true);
    setImportError(null);
    setStatus(null);

    const supabase = createClient();

    const { data: rulesRaw } = await supabase
      .from("category_rules")
      .select("category_id, match_type, pattern, priority, amount_sign")
      .eq("household_id", householdId);

    const { data: descRulesRaw } = await supabase
      .from("description_display_rules")
      .select("match_normalized, replacement_raw")
      .eq("household_id", householdId);

    const { data: incomeRulesRaw } = await supabase
      .from("income_classification_rules")
      .select("match_type, pattern, priority, treatment, amount_sign")
      .eq("household_id", householdId)
      .order("priority", { ascending: false });

    const incomeRules: IncomeRuleRow[] = (incomeRulesRaw ?? []).map((row) => ({
      match_type: row.match_type as IncomeRuleRow["match_type"],
      pattern: String(row.pattern ?? ""),
      priority: Number(row.priority ?? 0),
      treatment: row.treatment as IncomeRuleRow["treatment"],
      amount_sign: (row.amount_sign as IncomeRuleRow["amount_sign"]) ?? "any",
    }));

    const rules: CategoryRuleRow[] = (rulesRaw ?? []).map((row) => ({
      category_id: String(row.category_id),
      match_type: row.match_type as CategoryRuleRow["match_type"],
      pattern: String(row.pattern ?? ""),
      priority: Number(row.priority ?? 0),
      amount_sign: (row.amount_sign as CategoryRuleRow["amount_sign"]) ?? "any",
    }));

    const descRuleMap = buildDescriptionRuleMap(descRulesRaw ?? []);

    let existingKeys = new Set<string>();
    if (skipDuplicates) {
      const dates = parsed.map((r) => r.occurred_on);
      const minD = dates.reduce((a, b) => (a < b ? a : b));
      const maxD = dates.reduce((a, b) => (a > b ? a : b));
      const { keys, error: exErr } = await fetchExistingImportDedupeKeys(
        supabase,
        householdId,
        minD,
        maxD,
      );
      if (exErr) {
        setBusy(false);
        setImportError(exErr.message);
        return;
      }
      existingKeys = keys;
    }

    const toInsert: {
      household_id: string;
      category_id: string | null;
      amount: number;
      occurred_on: string;
      raw_description: string;
      normalized_description: string;
      created_by: string;
      income_treatment?: string;
    }[] = [];

    let skippedDup = 0;
    let skippedZero = 0;
    const seenInFile = new Set<string>();
    for (const r of parsed) {
      if (!Number.isFinite(r.amount) || r.amount === 0) {
        skippedZero += 1;
        continue;
      }
      const applied = applyDescriptionRules(r.raw_description, descRuleMap);
      const key = transactionImportDedupeKey(
        r.occurred_on,
        r.amount,
        applied.raw_description,
      );
      if (seenInFile.has(key)) {
        skippedDup += 1;
        continue;
      }
      seenInFile.add(key);
      if (skipDuplicates && existingKeys.has(key)) {
        skippedDup += 1;
        continue;
      }
      let category_id = matchChaseCategoryToId(
        r.bankCategoryHint,
        categories,
      );
      if (category_id == null) {
        category_id = resolveCategoryFromRules(
          applied.normalized_description,
          r.amount,
          rules,
        );
      }
      if (
        category_id == null &&
        r.amount < 0 &&
        descriptionExcludedFromOverviewAsCardPayment(
          applied.normalized_description,
          applied.raw_description,
        )
      ) {
        category_id = resolveCategoryIdByCanonicalName(
          categories,
          CREDIT_CARD_PAYMENT_CATEGORY,
        );
      }
      const incomeTag = resolveIncomeTreatmentFromRules(
        applied.normalized_description,
        r.amount,
        incomeRules,
      );
      toInsert.push({
        household_id: householdId,
        category_id,
        amount: r.amount,
        occurred_on: r.occurred_on,
        raw_description: applied.raw_description,
        normalized_description: applied.normalized_description,
        created_by: userId,
        ...(importAccountId.trim()
          ? { account_id: importAccountId.trim() }
          : {}),
        ...(incomeTag ? { income_treatment: incomeTag } : {}),
      });
    }

    let inserted = 0;
    let chunkError: string | null = null;
    const insertedUncategorizedIds: string[] = [];

    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
      const chunk = toInsert.slice(i, i + INSERT_CHUNK);
      const { data: insertedRows, error: insErr } = await supabase
        .from("transactions")
        .insert(chunk)
        .select("id, category_id");
      if (insErr) {
        chunkError = insErr.message;
        break;
      }
      const n = insertedRows?.length ?? chunk.length;
      inserted += n;
      for (const row of insertedRows ?? []) {
        if (row.category_id == null) {
          insertedUncategorizedIds.push(String(row.id));
        }
      }
    }

    let aiNote = "";
    if (!chunkError && insertedUncategorizedIds.length > 0) {
      const AI_BATCH = 100;
      let aiTotal = 0;
      for (let off = 0; off < insertedUncategorizedIds.length; off += AI_BATCH) {
        const slice = insertedUncategorizedIds.slice(off, off + AI_BATCH);
        const ai = await requestAutoCategorize(slice);
        if (!ai.ok) {
          if (ai.code !== "NO_AI_KEY") {
            aiNote = ` AI categorization stopped: ${ai.error}`;
          }
          break;
        }
        aiTotal += ai.updated;
      }
      if (aiTotal > 0) {
        aiNote = ` AI assigned categories to ${aiTotal} imported row${aiTotal === 1 ? "" : "s"} that had no category.`;
      }
    }

    setBusy(false);
    if (chunkError) {
      setImportError(
        `${chunkError} (${inserted} rows were inserted before the failure.)`,
      );
    } else {
      setStatus(
        `Imported ${inserted} transaction${inserted === 1 ? "" : "s"}.${skippedDup > 0 ? ` Skipped ${skippedDup} duplicate${skippedDup === 1 ? "" : "s"}.` : ""}${skippedZero > 0 ? ` Skipped ${skippedZero} row${skippedZero === 1 ? "" : "s"} with zero amount (not stored).` : ""}${aiNote}`,
      );
    }
    setParsed(null);
    setDetectedFormat(null);
    setFileLabel(null);
    router.refresh();
  }

  const preview = parsed?.slice(0, 8) ?? [];
  const showBankCategoryCol =
    parsed?.some((r) => r.bankCategoryHint.trim() !== "") ?? false;

  const Root = embedded ? "div" : "section";
  const rootClass = embedded
    ? "space-y-4"
    : "rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30";

  return (
    <Root className={rootClass}>
      {suppressHeading ? null : (
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Import from bank CSV
        </h2>
      )}
      <p
        className={`text-sm text-zinc-600 dark:text-zinc-400 ${suppressHeading ? "mt-0" : "mt-2"}`}
      >
        Supports{" "}
        <span className="font-medium">Chase</span> activity exports (
        <span className="font-mono text-xs">Transaction Date</span>,{" "}
        <span className="font-mono text-xs">Description</span>,{" "}
        <span className="font-mono text-xs">Category</span>,{" "}
        <span className="font-mono text-xs">Amount</span>) and{" "}
        <span className="font-medium">Bank of America</span> statement CSVs
        with a ledger table headed{" "}
        <span className="font-mono text-xs">Date, Description, Amount, Running Bal.</span>
        . Categories use your{" "}
        <span className="font-medium">rules</span> (same as manual entry); when
        the file includes a bank category name, it is matched to a household
        category by name if possible, then rules apply. Rows still without a
        category are sent through{" "}
        <span className="font-medium">AI categorization</span> when{" "}
        <span className="font-mono text-[11px]">OPENAI_API_KEY</span> is set on
        the server.
      </p>
      {accounts.length > 0 ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Imports are tagged to the account selected in the{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Account for imports &amp; new entries
          </span>{" "}
          control {embedded ? "at the top of this page" : "above this section"}.
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700">
          Choose file
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={onFileChange}
          />
        </label>
        {fileLabel ? (
          <span className="text-sm text-zinc-600">{fileLabel}</span>
        ) : null}
      </div>

      {parsed && parsed.length > 0 && detectedFormat ? (
        <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
          Detected format:{" "}
          <span className="font-medium">
            {formatSourceLabel(detectedFormat)}
          </span>
        </p>
      ) : null}

      {parseErrors.length > 0 ? (
        <ul
          className="mt-4 list-inside list-disc space-y-1 text-sm text-amber-800 dark:text-amber-200"
          role="status"
        >
          {parseErrors.slice(0, 8).map((msg, i) => (
            <li key={i}>{msg}</li>
          ))}
          {parseErrors.length > 8 ? (
            <li>…and {parseErrors.length - 8} more messages.</li>
          ) : null}
        </ul>
      ) : null}

      {parsed && parsed.length > 0 ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Ready to import {parsed.length} row
            {parsed.length === 1 ? "" : "s"} (preview below).
          </p>

          <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={skipDuplicates}
              onChange={(e) => setSkipDuplicates(e.target.checked)}
              className="mt-1"
            />
            <span>
              Skip rows that match an existing transaction (same date, amount,
              and display text after your description rules) in this household
              for the dates in this file.
            </span>
          </label>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-950/50">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-800/70 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Description</th>
                  {showBankCategoryCol ? (
                    <th className="px-3 py-2">Bank category</th>
                  ) : null}
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {preview.map((r, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      {r.occurred_on}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-zinc-900 dark:text-zinc-100">
                      {r.raw_description}
                    </td>
                    {showBankCategoryCol ? (
                      <td className="px-3 py-2 text-zinc-600">
                        {r.bankCategoryHint || "—"}
                      </td>
                    ) : null}
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {formatUsd(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.length > preview.length ? (
              <p className="border-t border-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                …and {parsed.length - preview.length} more rows
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={runImport}
              disabled={busy}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {busy ? "Importing…" : "Import into ledger"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {importError ? (
        <p className="mt-4 text-sm text-red-700 dark:text-red-400" role="alert">
          {importError}
        </p>
      ) : null}
      {status ? (
        <p className="mt-4 text-sm text-emerald-800 dark:text-emerald-300" role="status">
          {status}
        </p>
      ) : null}
    </Root>
  );
}

/** @deprecated Prefer `TransactionCsvImport`; kept for existing imports. */
export const ChaseCsvImport = TransactionCsvImport;
