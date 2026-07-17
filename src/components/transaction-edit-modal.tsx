"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { amountSignForRememberRule } from "@/lib/amount-sign-filter";
import { createClient } from "@/lib/supabase/client";
import {
  ledgerArchiveColumnExists,
  withActiveLedgerOnly,
} from "@/lib/ledger-archive-schema";
import { normalizeDescription } from "@/lib/normalize-description";
import {
  formatCategoryLabel,
  sortCategoriesForPicker,
} from "@/lib/category-display";
import { categoryDisplayName } from "@/lib/dashboard-analytics";
import { formatUsd } from "@/lib/money";
import type { AccountRow, CategoryRow, ReceiptRow, SavingsPlanRow, TransactionRow } from "@/types/finance";
import { ReceiptUploader } from "@/components/receipt-uploader";

type Props = {
  transaction: TransactionRow | null;
  householdId: string;
  categories: CategoryRow[];
  accounts?: AccountRow[];
  plans?: SavingsPlanRow[];
  /** Rows in the ledger that share normalized_description with this transaction */
  matchCount: number;
  /** When false, archive column is omitted from filters (DB migration not applied). */
  ledgerArchiveColumnAvailable?: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type RenameEvent = {
  id: string;
  source_normalized: string;
  new_raw: string;
  scope: string;
  rows_affected: number;
  rule_remembered: boolean;
  created_at: string;
};

export function TransactionEditModal({
  transaction,
  householdId,
  categories,
  accounts = [],
  plans = [],
  matchCount,
  ledgerArchiveColumnAvailable,
  onClose,
  onSaved,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categoryScope, setCategoryScope] = useState<"this" | "all">("this");
  const [descriptionScope, setDescriptionScope] = useState<"this" | "all">(
    "this",
  );
  const [rememberRule, setRememberRule] = useState(false);
  const [rememberDescriptionRule, setRememberDescriptionRule] = useState(false);
  const [incomeOverview, setIncomeOverview] = useState<
    "" | "include" | "exclude"
  >("");
  const [isBusinessExpense, setIsBusinessExpense] = useState(false);
  const [savingsPlanId, setSavingsPlanId] = useState("");
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renameHistory, setRenameHistory] = useState<RenameEvent[]>([]);

  const originalNormalized = transaction?.normalized_description ?? "";

  const resetFormFromTransaction = useCallback(() => {
    if (!transaction) return;
    setDescription(transaction.raw_description);
    setNotes(transaction.notes ?? "");
    setAccountId(transaction.account_id ?? "");
    setCategoryId(transaction.category_id ?? "");
    setCategoryScope("this");
    setDescriptionScope("this");
    setRememberRule(false);
    setRememberDescriptionRule(false);
    setIncomeOverview(
      transaction.amount > 0
        ? transaction.income_treatment ?? ""
        : "",
    );
    setIsBusinessExpense(transaction.is_business_expense ?? false);
    setSavingsPlanId(transaction.savings_plan_id ?? "");
    setError(null);
  }, [transaction]);

  useEffect(() => {
    if (!transaction) return;
    resetFormFromTransaction();
    setIsEditing(false);
  }, [transaction, resetFormFromTransaction]);

  useEffect(() => {
    if (!transaction) {
      setReceipts([]);
      return;
    }
    const supabase = createClient();
    void supabase
      .from("transaction_receipts")
      .select("id, transaction_id, file_path, file_name, file_size, mime_type, created_at")
      .eq("transaction_id", transaction.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setReceipts((data as ReceiptRow[]) ?? []);
      });
  }, [transaction]);

  useEffect(() => {
    if (!transaction) {
      setRenameHistory([]);
      return;
    }
    const supabase = createClient();
    void supabase
      .from("description_rename_events")
      .select(
        "id, source_normalized, new_raw, scope, rows_affected, rule_remembered, created_at",
      )
      .eq("household_id", householdId)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (!error && data) {
          setRenameHistory(data as RenameEvent[]);
        } else {
          setRenameHistory([]);
        }
      });
  }, [transaction, householdId]);

  const cancelEdit = useCallback(() => {
    resetFormFromTransaction();
    setIsEditing(false);
  }, [resetFormFromTransaction]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || !transaction || saving) return;
      if (isEditing) {
        e.preventDefault();
        cancelEdit();
      } else {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [transaction, saving, isEditing, onClose, cancelEdit]);

  if (!transaction) return null;

  const sortedCats = sortCategoriesForPicker(categories);
  const sortedAccounts = [...accounts].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const catIdForSave = categoryId === "" ? null : categoryId;
  const canRememberRule = catIdForSave != null;

  const viewCategoryName = transaction.categories
    ? categoryDisplayName(transaction)
    : null;
  const viewCategoryColor = transaction.categories?.color ?? null;
  const viewAccountName =
    sortedAccounts.find((a) => a.id === transaction.account_id)?.name ??
    transaction.account_name ??
    null;

  const newDescTrimmed = description.trim();
  const newNorm = normalizeDescription(newDescTrimmed);
  const descDirty =
    newDescTrimmed !== transaction.raw_description.trim() ||
    newNorm !== originalNormalized;

  async function handleSave() {
    if (!transaction) return;
    if (!newDescTrimmed) {
      setError("Description cannot be empty.");
      return;
    }
    if (!canRememberRule && rememberRule) {
      setRememberRule(false);
    }
    if (!descDirty && rememberDescriptionRule) {
      setRememberDescriptionRule(false);
    }

    setError(null);
    setSaving(true);
    const supabase = createClient();

    try {
      const hasLedgerArchive =
        ledgerArchiveColumnAvailable ??
        (await ledgerArchiveColumnExists(supabase));

      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? null;

      let countQ = supabase
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("household_id", householdId)
        .eq("normalized_description", originalNormalized);
      countQ = withActiveLedgerOnly(countQ, hasLedgerArchive);
      const { count: matchCountExact } = await countQ;

      const rowsMatchingOriginal = Math.max(
        matchCount,
        matchCountExact ?? 0,
        1,
      );

      const batchPatch: Record<string, unknown> = {};
      if (categoryScope === "all") {
        batchPatch.category_id = catIdForSave;
      }
      if (descriptionScope === "all" && descDirty) {
        batchPatch.raw_description = newDescTrimmed;
        batchPatch.normalized_description = newNorm;
      }

      if (Object.keys(batchPatch).length > 0) {
        let batchQ = supabase
          .from("transactions")
          .update(batchPatch)
          .eq("household_id", householdId)
          .eq("normalized_description", originalNormalized);
        batchQ = withActiveLedgerOnly(batchQ, hasLedgerArchive);
        const { error: batchErr } = await batchQ;

        if (batchErr) {
          setError(batchErr.message);
          return;
        }
      }

      const singlePatch: Record<string, unknown> = {
        notes: notes.trim() || null,
      };
      if (transaction.amount > 0) {
        const nextIncome =
          incomeOverview === "" ? null : incomeOverview;
        const prevIncome = transaction.income_treatment ?? null;
        if (nextIncome !== prevIncome) {
          singlePatch.income_treatment = nextIncome;
        }
      }
      if (categoryScope === "this") {
        singlePatch.category_id = catIdForSave;
      }
      singlePatch.account_id = accountId === "" ? null : accountId;
      singlePatch.is_business_expense = isBusinessExpense;
      singlePatch.savings_plan_id = savingsPlanId === "" ? null : savingsPlanId;
      if (descriptionScope === "this" && descDirty) {
        singlePatch.raw_description = newDescTrimmed;
        singlePatch.normalized_description = newNorm;
      }

      const { error: rowErr } = await supabase
        .from("transactions")
        .update(singlePatch)
        .eq("id", transaction.id)
        .eq("household_id", householdId);

      if (rowErr) {
        setError(rowErr.message);
        return;
      }

      if (rememberRule && catIdForSave) {
        const { error: ruleErr } = await supabase.from("category_rules").upsert(
          {
            household_id: householdId,
            category_id: catIdForSave,
            match_type: "exact_normalized",
            pattern: newNorm,
            priority: 200,
            amount_sign: amountSignForRememberRule(transaction.amount),
          },
          { onConflict: "household_id,match_type,pattern,amount_sign" },
        );

        if (ruleErr) {
          setError(
            `Transaction saved, but the "remember for future" category rule failed: ${ruleErr.message}`,
          );
          onSaved();
          return;
        }
      }

      if (rememberDescriptionRule && descDirty) {
        const { error: descRuleErr } = await supabase
          .from("description_display_rules")
          .upsert(
            {
              household_id: householdId,
              match_normalized: originalNormalized,
              replacement_raw: newDescTrimmed,
            },
            { onConflict: "household_id,match_normalized" },
          );

        if (descRuleErr) {
          setError(
            `Transaction saved, but saving the description rule failed: ${descRuleErr.message}`,
          );
          onSaved();
          return;
        }
      }

      if (descDirty) {
        const affected =
          descriptionScope === "all" ? rowsMatchingOriginal : 1;
        const { error: histErr } = await supabase
          .from("description_rename_events")
          .insert({
            household_id: householdId,
            source_normalized: originalNormalized,
            new_raw: newDescTrimmed,
            scope: descriptionScope,
            rows_affected: affected,
            rule_remembered: rememberDescriptionRule,
            created_by: uid,
          });

        if (histErr) {
          setError(
            `Saved, but the rename history entry failed: ${histErr.message}`,
          );
          onSaved();
          return;
        }
      }

      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function formatHistoryTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return iso;
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-detail-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              id="tx-detail-title"
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
            >
              {isEditing ? "Edit transaction" : "Transaction details"}
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              <span className="tabular-nums">{transaction.occurred_on}</span>
              <span className="text-zinc-400 dark:text-zinc-600"> · </span>
              <span
                className={
                  transaction.amount < 0
                    ? "font-medium text-zinc-900 dark:text-zinc-100"
                    : "font-medium text-emerald-700 dark:text-emerald-400"
                }
              >
                {formatUsd(transaction.amount)}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {!isEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Close
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel edit
              </button>
            )}
          </div>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-red-700 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        {!isEditing ? (
          <div className="mt-6 space-y-5 text-sm">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Description
              </h3>
              <p className="mt-1.5 whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
                {transaction.raw_description}
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Notes
              </h3>
              <p className="mt-1.5 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                {transaction.notes?.trim()
                  ? transaction.notes
                  : "No notes for this transaction."}
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Account
              </h3>
              <p className="mt-1.5 whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
                {viewAccountName ?? "No account selected."}
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Category
              </h3>
              <div className="mt-1.5">
                {viewCategoryName ? (
                  <span className="inline-flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
                      style={{
                        backgroundColor: viewCategoryColor || "#94a3b8",
                      }}
                      aria-hidden
                    />
                    {viewCategoryName}
                  </span>
                ) : (
                  <span className="text-zinc-500 dark:text-zinc-400">Uncategorized</span>
                )}
              </div>
            </div>
            {transaction.amount > 0 ? (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Overview income
                </h3>
                <p className="mt-1.5 text-zinc-800 dark:text-zinc-200">
                  {transaction.income_treatment === "exclude"
                    ? "Excluded from Overview income totals."
                    : transaction.income_treatment === "include"
                      ? "Always included in Overview income."
                      : "Automatic: income rules, then default (credits usually count)."}
                </p>
              </div>
            ) : null}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Business expense
              </h3>
              <p className="mt-1.5 text-zinc-800 dark:text-zinc-200">
                {transaction.is_business_expense
                  ? "Yes — flagged for tax reporting."
                  : "No"}
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Receipts
              </h3>
              <div className="mt-2">
                <ReceiptUploader
                  transactionId={transaction.id}
                  initialReceipts={receipts}
                  onChange={setReceipts}
                />
              </div>
            </div>
            {renameHistory.length > 0 ? (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Recent description renames
                </h3>
                <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto text-xs text-zinc-600 dark:text-zinc-400">
                  {renameHistory.map((ev) => (
                    <li
                      key={ev.id}
                      className="rounded-md border border-zinc-100 bg-zinc-50/80 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950/60"
                    >
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">
                        {ev.new_raw}
                      </span>
                      <span className="mt-0.5 block text-zinc-500 dark:text-zinc-400">
                        {formatHistoryTime(ev.created_at)}
                        {" · "}
                        {ev.scope === "all"
                          ? `${ev.rows_affected} rows`
                          : "this row"}
                        {ev.rule_remembered ? " · saved for future" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {matchCount > 1 ? (
              <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-950/60 dark:text-zinc-400">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{matchCount}</span>{" "}
                transactions share the same normalized description. Use{" "}
                <span className="font-medium">Edit</span> to change the label
                and/or category for all of them.
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <div className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="edit-tx-desc"
                  className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                >
                  Description
                </label>
                <textarea
                  id="edit-tx-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-tx-notes"
                  className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                >
                  Notes (optional)
                </label>
                <textarea
                  id="edit-tx-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Anything you want to remember about this purchase or payment"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-500/25"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-tx-account"
                  className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                >
                  Account
                </label>
                <select
                  id="edit-tx-account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                >
                  <option value="">No account</option>
                  {sortedAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="edit-tx-cat"
                  className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                >
                  Category
                </label>
                <select
                  id="edit-tx-cat"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                >
                  <option value="">Uncategorized</option>
                  {sortedCats.map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                      title={c.description ?? undefined}
                    >
                      {formatCategoryLabel(c, categories)}
                    </option>
                  ))}
                </select>
              </div>

              {transaction.amount > 0 ? (
                <div className="sm:col-span-2">
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Overview income (this credit)
                  </span>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Controls whether this amount is summed in Overview income
                    bars. Per-row setting overrides income rules.
                  </p>
                  <div className="mt-2 space-y-2">
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <input
                        type="radio"
                        name="income-overview"
                        checked={incomeOverview === ""}
                        onChange={() => setIncomeOverview("")}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          Automatic
                        </span>
                        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                          Use income rules and defaults.
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <input
                        type="radio"
                        name="income-overview"
                        checked={incomeOverview === "include"}
                        onChange={() => setIncomeOverview("include")}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium text-zinc-900">
                          Always count as income
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <input
                        type="radio"
                        name="income-overview"
                        checked={incomeOverview === "exclude"}
                        onChange={() => setIncomeOverview("exclude")}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          Never count as income
                        </span>
                        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                          For refunds, rewards, and other non-income credits.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              ) : null}

              <fieldset className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700 dark:bg-zinc-950/40">
                <legend className="px-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Description change applies to
                </legend>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input
                    type="radio"
                    name="desc-scope"
                    checked={descriptionScope === "this"}
                    onChange={() => setDescriptionScope("this")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      This transaction only
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input
                    type="radio"
                    name="desc-scope"
                    checked={descriptionScope === "all"}
                    onChange={() => setDescriptionScope("all")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      All with the same name
                    </span>
                    <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                      Updates{" "}
                      <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                        {matchCount}
                      </span>{" "}
                      row
                      {matchCount === 1 ? "" : "s"} that share this
                      transaction&apos;s current normalized description (before
                      your edit).
                    </span>
                  </span>
                </label>
              </fieldset>

              <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={rememberDescriptionRule && descDirty}
                  disabled={!descDirty}
                  onChange={(e) => setRememberDescriptionRule(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    Remember for future
                  </span>
                  <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                    New transactions and CSV lines whose text normalizes to the
                    same value as <span className="font-medium">before this
                    edit</span> will use this new label automatically. Requires
                    changing the description text above.
                  </span>
                </span>
              </label>

              <fieldset className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700 dark:bg-zinc-950/40">
                <legend className="px-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Category change applies to
                </legend>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input
                    type="radio"
                    name="cat-scope"
                    checked={categoryScope === "this"}
                    onChange={() => setCategoryScope("this")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      This transaction only
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input
                    type="radio"
                    name="cat-scope"
                    checked={categoryScope === "all"}
                    onChange={() => setCategoryScope("all")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      All with the same name (before edit)
                    </span>
                    <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                      Matches{" "}
                      <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                        {matchCount}
                      </span>{" "}
                      row
                      {matchCount === 1 ? "" : "s"} sharing the{" "}
                      <span className="font-medium">original</span> normalized
                      description. If you also rename all of them, use the
                      description scope above.
                    </span>
                  </span>
                </label>
              </fieldset>

              <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={rememberRule && canRememberRule}
                  disabled={!canRememberRule}
                  onChange={(e) => setRememberRule(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    Remember category for future
                  </span>
                  <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                    Rule matches the <span className="font-medium">new</span>{" "}
                    normalized description after you save (exact match for
                    imports and new entries). Requires a category.
                  </span>
                </span>
              </label>

              {plans.length > 0 && (
                <div>
                  <label
                    htmlFor="edit-tx-plan"
                    className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                  >
                    Savings plan (optional)
                  </label>
                  <select
                    id="edit-tx-plan"
                    value={savingsPlanId}
                    onChange={(e) => setSavingsPlanId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                  >
                    <option value="">Not linked to a plan</option>
                    {plans.filter((p) => !p.is_archived).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    Link this transaction to a plan and its amount counts toward the goal.
                  </p>
                </div>
              )}

              <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={isBusinessExpense}
                  onChange={(e) => setIsBusinessExpense(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    Business expense
                  </span>
                  <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                    Flag this transaction for tax reporting. Flagged transactions
                    can be filtered and exported from the Transactions page.
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Receipts
              </p>
              <ReceiptUploader
                transactionId={transaction.id}
                initialReceipts={receipts}
                onChange={setReceipts}
              />
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Discard changes
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
