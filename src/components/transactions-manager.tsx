"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  resolveCategoryFromRules,
  type CategoryRuleRow,
} from "@/lib/apply-category-rules";
import {
  resolveIncomeTreatmentFromRules,
  type IncomeRuleRow,
} from "@/lib/apply-income-rules";
import { requestClassifyIncome } from "@/lib/auto-classify-income-client";
import {
  applyDescriptionRules,
  buildDescriptionRuleMap,
} from "@/lib/apply-description-rules";
import { requestAutoCategorize } from "@/lib/auto-categorize-client";
import { formatUsd } from "@/lib/money";
import { TransactionCsvImport } from "@/components/chase-csv-import";
import { ReceiptPopover } from "@/components/receipt-popover";
import {
  resolveCategoryIdByCanonicalName,
} from "@/lib/chase-category-match";
import { descriptionExcludedFromOverviewAsCardPayment } from "@/lib/detect-credit-card-payment-description";
import {
  dedupeTransactionsById,
  filterIncomeDuplicateGroups,
  findDuplicateTransactionGroups,
  type DuplicateTransactionGroup,
} from "@/lib/find-duplicate-transaction-groups";
import { TransactionEditModal } from "@/components/transaction-edit-modal";
import { mapTransactionRow } from "@/lib/map-transaction";
import { LEDGER_ARCHIVED_AT } from "@/lib/ledger-archived";
import { promotePlaidFeedRowToLedger } from "@/lib/promote-plaid-feed-to-ledger";
import {
  formatCategoryLabel,
  sortCategoriesForPicker,
} from "@/lib/category-display";
import { categoryDisplayName } from "@/lib/dashboard-analytics";
import type { AccountRow, CategoryRow, SavingsPlanRow, TransactionRow } from "@/types/finance";

export type { TransactionRow } from "@/types/finance";

const CREDIT_CARD_PAYMENT_CATEGORY = "credit card payment";

type Props = {
  householdId: string;
  userId: string;
  categories: CategoryRow[];
  incomeRules: IncomeRuleRow[];
  initialTransactions: TransactionRow[];
  /** Soft-archived ledger rows (non-Plaid); excluded from overview until restored. */
  initialArchivedTransactions: TransactionRow[];
  accounts: AccountRow[];
  /** When a single account exists, pre-select it from the server. */
  defaultAccountId: string | null;
  /** When false, soft-archive UI is hidden (DB migration not applied). */
  ledgerArchiveColumnAvailable: boolean;
  plans?: SavingsPlanRow[];
};

function parseAmount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseFloat(value);
  return Number.NaN;
}

/** Every whitespace-separated token must appear (case-insensitive) in the combined text. */
function transactionMatchesKeywordSearch(
  t: TransactionRow,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  const primaryName = t.categories?.primary_group?.name ?? "";
  const hay = [
    t.raw_description,
    t.normalized_description,
    t.notes ?? "",
    t.categories?.name ?? "",
    primaryName,
    t.occurred_on,
    String(t.amount),
  ]
    .join(" ")
    .toLowerCase();
  return tokens.every((tok) => hay.includes(tok));
}

export function TransactionsManager({
  householdId,
  userId,
  categories,
  incomeRules,
  initialTransactions,
  initialArchivedTransactions,
  accounts,
  defaultAccountId,
  ledgerArchiveColumnAvailable,
  plans = [],
}: Props) {
  const router = useRouter();
  const [importAccountId, setImportAccountId] = useState(
    () => defaultAccountId ?? "",
  );
  const [csvImportModalOpen, setCsvImportModalOpen] = useState(false);
  const [addTxModalOpen, setAddTxModalOpen] = useState(false);
  const [dupModalOpen, setDupModalOpen] = useState(false);

  useEffect(() => {
    setImportAccountId(defaultAccountId ?? "");
  }, [defaultAccountId]);

  useEffect(() => {
    if (!csvImportModalOpen && !dupModalOpen && !addTxModalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (csvImportModalOpen) setCsvImportModalOpen(false);
      else if (dupModalOpen) setDupModalOpen(false);
      else if (addTxModalOpen) setAddTxModalOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [csvImportModalOpen, dupModalOpen, addTxModalOpen]);
  const [rows, setRows] = useState<TransactionRow[]>(() =>
    dedupeTransactionsById(initialTransactions),
  );
  const [amount, setAmount] = useState("");
  const [flow, setFlow] = useState<"expense" | "income">("expense");
  const [occurredOn, setOccurredOn] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingTx, setEditingTx] = useState<TransactionRow | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiIncomeBusy, setAiIncomeBusy] = useState(false);
  const [aiIncomeMessage, setAiIncomeMessage] = useState<string | null>(null);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerCategoryFilter, setLedgerCategoryFilter] = useState("");
  const [ledgerAccountFilter, setLedgerAccountFilter] = useState("");
  const [businessExpenseOnly, setBusinessExpenseOnly] = useState(false);
  const [savedKeywordFilters, setSavedKeywordFilters] = useState<string[]>([]);
  const [activeKeywordFilters, setActiveKeywordFilters] = useState<string[]>([]);
  const [newKeywordFilter, setNewKeywordFilter] = useState("");
  const [dupScope, setDupScope] = useState<"all" | "income">("all");
  const [dupSearch, setDupSearch] = useState("");
  const [dupDeleteIds, setDupDeleteIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [dupBusy, setDupBusy] = useState(false);
  const [archivedRows, setArchivedRows] = useState<TransactionRow[]>(() =>
    dedupeTransactionsById(initialArchivedTransactions),
  );
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreThroughDate, setRestoreThroughDate] = useState("");
  const [restoreRangeStart, setRestoreRangeStart] = useState("");
  const [restoreRangeEnd, setRestoreRangeEnd] = useState("");
  const accountNameById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );

  useEffect(() => {
    const key = `tx-keyword-filters:${householdId}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const cleaned = parsed
        .map((x) => String(x).trim())
        .filter((x) => x.length > 0);
      setSavedKeywordFilters(cleaned);
    } catch {
      // ignore malformed localStorage
    }
  }, [householdId]);

  useEffect(() => {
    const key = `tx-keyword-filters:${householdId}`;
    try {
      window.localStorage.setItem(key, JSON.stringify(savedKeywordFilters));
    } catch {
      // localStorage may be unavailable; ignore
    }
  }, [savedKeywordFilters, householdId]);

  useEffect(() => {
    setRows(dedupeTransactionsById(initialTransactions));
  }, [initialTransactions]);

  useEffect(() => {
    setArchivedRows(dedupeTransactionsById(initialArchivedTransactions));
  }, [initialArchivedTransactions]);

  /** Distinct transactions by id (guards against duplicate rows in state / server payload). */
  const uniqueRows = useMemo(() => dedupeTransactionsById(rows), [rows]);

  const nonPlaidLedgerActiveCount = useMemo(
    () =>
      uniqueRows.filter(
        (r) =>
          !r.plaid_feed_only &&
          (r.plaid_transaction_id == null ||
            String(r.plaid_transaction_id).trim() === ""),
      ).length,
    [uniqueRows],
  );

  useEffect(() => {
    const valid = new Set(uniqueRows.map((r) => r.id));
    setDupDeleteIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
      }
      return next;
    });
  }, [uniqueRows]);

  const duplicateGroups = useMemo(
    () =>
      findDuplicateTransactionGroups(
        uniqueRows.filter((r) => !r.plaid_feed_only),
      ),
    [uniqueRows],
  );

  const incomeDuplicateGroups = useMemo(
    () => filterIncomeDuplicateGroups(duplicateGroups),
    [duplicateGroups],
  );

  const activeDupGroups = useMemo(
    () =>
      dupScope === "income" ? incomeDuplicateGroups : duplicateGroups,
    [dupScope, duplicateGroups, incomeDuplicateGroups],
  );

  const dupExtraCopies = useMemo(
    () =>
      duplicateGroups.reduce((n, g) => n + (g.members.length - 1), 0),
    [duplicateGroups],
  );

  const incomeDupExtraCopies = useMemo(
    () =>
      incomeDuplicateGroups.reduce((n, g) => n + (g.members.length - 1), 0),
    [incomeDuplicateGroups],
  );

  const filteredDupGroups = useMemo(() => {
    const q = dupSearch.trim();
    if (!q) return activeDupGroups;
    return activeDupGroups.filter((g) =>
      g.members.some((t) => transactionMatchesKeywordSearch(t, dupSearch)),
    );
  }, [activeDupGroups, dupSearch]);

  const filteredRows = useMemo(() => {
    return uniqueRows.filter((r) => {
      if (!transactionMatchesKeywordSearch(r, ledgerSearch)) {
        return false;
      }
      if (ledgerCategoryFilter) {
        if (ledgerCategoryFilter === "__uncategorized__") {
          if (r.category_id != null) return false;
        } else if (r.category_id !== ledgerCategoryFilter) {
          return false;
        }
      }
      if (ledgerAccountFilter) {
        const rowAccountLabel =
          r.account_name ??
          (r.account_id ? accountNameById.get(r.account_id) ?? null : null);
        if (ledgerAccountFilter === "__no_account__") {
          if (r.account_id != null || rowAccountLabel != null) return false;
        } else if (ledgerAccountFilter.startsWith("__feed_name__:")) {
          const wanted = ledgerAccountFilter.slice("__feed_name__:".length);
          if ((rowAccountLabel ?? "") !== wanted) return false;
        } else if (r.account_id !== ledgerAccountFilter) {
          return false;
        }
      }
      if (businessExpenseOnly && !r.is_business_expense) {
        return false;
      }
      for (const kw of activeKeywordFilters) {
        if (!transactionMatchesKeywordSearch(r, kw)) {
          return false;
        }
      }
      return true;
    });
  }, [
    uniqueRows,
    ledgerSearch,
    ledgerCategoryFilter,
    ledgerAccountFilter,
    businessExpenseOnly,
    activeKeywordFilters,
    accountNameById,
  ]);

  const sortedCategoryOptions = useMemo(
    () => sortCategoriesForPicker(categories),
    [categories],
  );
  const feedOnlyAccountNames = useMemo(() => {
    const names = new Set<string>();
    for (const r of uniqueRows) {
      if (r.plaid_feed_only && r.account_name) names.add(r.account_name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [uniqueRows]);

  const restoreThroughMatchCount = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(restoreThroughDate.trim())) return 0;
    const cutoff = restoreThroughDate.trim();
    return archivedRows.filter((r) => r.occurred_on <= cutoff).length;
  }, [archivedRows, restoreThroughDate]);

  const restoreRangeMatchCount = useMemo(() => {
    const a = restoreRangeStart.trim();
    const b = restoreRangeEnd.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return 0;
    const lo = a <= b ? a : b;
    const hi = a <= b ? b : a;
    return archivedRows.filter(
      (r) => r.occurred_on >= lo && r.occurred_on <= hi,
    ).length;
  }, [archivedRows, restoreRangeStart, restoreRangeEnd]);

  function signedAmount(): number | null {
    const n = Number.parseFloat(amount);
    if (Number.isNaN(n) || n <= 0) return null;
    return flow === "expense" ? -n : n;
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (accounts.length > 0 && !importAccountId.trim()) {
      setError("Choose an account at the top of the page for this transaction.");
      return;
    }
    const amt = signedAmount();
    const desc = description.trim();
    if (amt === null) {
      setError("Enter a positive amount.");
      return;
    }
    if (!desc) {
      setError("Enter a short description (e.g. store or payee).");
      return;
    }
    setLoading(true);
    const supabase = createClient();

    const { data: descRulesRaw } = await supabase
      .from("description_display_rules")
      .select("match_normalized, replacement_raw")
      .eq("household_id", householdId);

    const descRuleMap = buildDescriptionRuleMap(descRulesRaw ?? []);
    const applied = applyDescriptionRules(desc, descRuleMap);

    let resolvedCategoryId = categoryId || null;
    if (!resolvedCategoryId) {
      const { data: rulesRaw } = await supabase
        .from("category_rules")
        .select("category_id, match_type, pattern, priority, amount_sign")
        .eq("household_id", householdId);
      const rules: CategoryRuleRow[] = (rulesRaw ?? []).map((row) => ({
        category_id: String(row.category_id),
        match_type: row.match_type as CategoryRuleRow["match_type"],
        pattern: String(row.pattern ?? ""),
        priority: Number(row.priority ?? 0),
        amount_sign: (row.amount_sign as CategoryRuleRow["amount_sign"]) ?? "any",
      }));
      resolvedCategoryId = resolveCategoryFromRules(
        applied.normalized_description,
        amt,
        rules,
      );
    }
    if (
      resolvedCategoryId == null &&
      amt < 0 &&
      descriptionExcludedFromOverviewAsCardPayment(
        applied.normalized_description,
        applied.raw_description,
      )
    ) {
      resolvedCategoryId = resolveCategoryIdByCanonicalName(
        categories,
        CREDIT_CARD_PAYMENT_CATEGORY,
      );
    }

    const incomeTag = resolveIncomeTreatmentFromRules(
      applied.normalized_description,
      amt,
      incomeRules,
    );

    const insertRow: Record<string, unknown> = {
      household_id: householdId,
      category_id: resolvedCategoryId,
      amount: amt,
      occurred_on: occurredOn,
      raw_description: applied.raw_description,
      normalized_description: applied.normalized_description,
      created_by: userId,
    };
    if (importAccountId.trim()) {
      insertRow.account_id = importAccountId.trim();
    }
    if (incomeTag) {
      insertRow.income_treatment = incomeTag;
    }

    const { data, error: insertError } = await supabase
      .from("transactions")
      .insert(insertRow)
      .select(
        `
        id,
        amount,
        occurred_on,
        raw_description,
        normalized_description,
        notes,
        account_id,
        category_id,
        income_treatment,
        categories (
          name,
          color,
          parent_category_id,
          parent:parent_category_id ( name ),
          primary_category_groups ( name, slug )
        )
      `,
      )
      .single();

    setLoading(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    if (data) {
      const row = mapTransactionRow(data);
      setRows((prev) => dedupeTransactionsById([row, ...prev]));
      setAmount("");
      setDescription("");
      setCategoryId("");
      setAddTxModalOpen(false);
    }
    router.refresh();
  }

  async function openRowForEdit(r: TransactionRow) {
    if (!r.plaid_feed_only) {
      setEditingTx(r);
      return;
    }
    setLoading(true);
    setError(null);
    const { row, error: promErr } = await promotePlaidFeedRowToLedger(
      r,
      householdId,
      userId,
    );
    setLoading(false);
    if (promErr || !row) {
      setError(
        promErr ?? "Could not add this bank transaction to your ledger.",
      );
      return;
    }
    setRows((prev) => {
      const next = prev.filter((x) => x.id !== r.id);
      return dedupeTransactionsById([row, ...next]);
    });
    setEditingTx(row);
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this transaction?")) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: delError } = await supabase
      .from("transactions")
      .delete()
      .eq("id", id)
      .eq("household_id", householdId);
    setLoading(false);
    if (delError) {
      setError(delError.message);
      return;
    }
    setRows((prev) => dedupeTransactionsById(prev.filter((r) => r.id !== id)));
    setArchivedRows((prev) => prev.filter((r) => r.id !== id));
    router.refresh();
  }

  async function archiveAllNonPlaidLedger() {
    if (!ledgerArchiveColumnAvailable) return;
    if (nonPlaidLedgerActiveCount === 0) return;
    if (
      !window.confirm(
        `Archive all ${nonPlaidLedgerActiveCount} non-Plaid transaction(s)? They will disappear from this ledger and from the dashboard until you restore them below.`,
      )
    ) {
      return;
    }
    setError(null);
    setArchiveBusy(true);
    const supabase = createClient();
    const now = new Date().toISOString();
    const { error: upErr } = await supabase
      .from("transactions")
      .update({ [LEDGER_ARCHIVED_AT]: now })
      .eq("household_id", householdId)
      .is("plaid_transaction_id", null)
      .is(LEDGER_ARCHIVED_AT, null);
    setArchiveBusy(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    router.refresh();
  }

  async function restoreArchivedTransaction(id: string) {
    if (!ledgerArchiveColumnAvailable) return;
    setError(null);
    setRestoreBusy(true);
    const supabase = createClient();
    const { error: upErr } = await supabase
      .from("transactions")
      .update({ [LEDGER_ARCHIVED_AT]: null })
      .eq("id", id)
      .eq("household_id", householdId);
    setRestoreBusy(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    router.refresh();
  }

  async function restoreAllArchived() {
    if (!ledgerArchiveColumnAvailable) return;
    if (archivedRows.length === 0) return;
    if (
      !window.confirm(
        `Restore all ${archivedRows.length} archived transaction(s) to the active ledger?`,
      )
    ) {
      return;
    }
    setError(null);
    setRestoreBusy(true);
    const supabase = createClient();
    const { error: upErr } = await supabase
      .from("transactions")
      .update({ [LEDGER_ARCHIVED_AT]: null })
      .eq("household_id", householdId)
      .not(LEDGER_ARCHIVED_AT, "is", null)
      .is("plaid_transaction_id", null);
    setRestoreBusy(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    router.refresh();
  }

  async function restoreArchivedThroughSelectedDate() {
    if (!ledgerArchiveColumnAvailable) return;
    const cutoff = restoreThroughDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
      setError("Pick a valid restore date (YYYY-MM-DD).");
      return;
    }
    const eligible = archivedRows.filter((r) => r.occurred_on <= cutoff);
    if (eligible.length === 0) {
      setError(`No archived rows on or before ${cutoff}.`);
      return;
    }
    if (
      !window.confirm(
        `Restore ${eligible.length} archived transaction(s) dated ${cutoff} and earlier?`,
      )
    ) {
      return;
    }
    setError(null);
    setRestoreBusy(true);
    const supabase = createClient();
    const { error: upErr } = await supabase
      .from("transactions")
      .update({ [LEDGER_ARCHIVED_AT]: null })
      .eq("household_id", householdId)
      .not(LEDGER_ARCHIVED_AT, "is", null)
      .is("plaid_transaction_id", null)
      .lte("occurred_on", cutoff);
    setRestoreBusy(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    router.refresh();
  }

  async function restoreArchivedInDateRange() {
    if (!ledgerArchiveColumnAvailable) return;
    let start = restoreRangeStart.trim();
    let end = restoreRangeEnd.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      setError("Pick valid start and end dates (YYYY-MM-DD).");
      return;
    }
    if (start > end) {
      [start, end] = [end, start];
    }
    const eligible = archivedRows.filter(
      (r) => r.occurred_on >= start && r.occurred_on <= end,
    );
    if (eligible.length === 0) {
      setError(`No archived rows between ${start} and ${end} (inclusive).`);
      return;
    }
    if (
      !window.confirm(
        `Restore ${eligible.length} archived transaction(s) from ${start} through ${end} (inclusive)?`,
      )
    ) {
      return;
    }
    setError(null);
    setRestoreBusy(true);
    const supabase = createClient();
    const { error: upErr } = await supabase
      .from("transactions")
      .update({ [LEDGER_ARCHIVED_AT]: null })
      .eq("household_id", householdId)
      .not(LEDGER_ARCHIVED_AT, "is", null)
      .is("plaid_transaction_id", null)
      .gte("occurred_on", start)
      .lte("occurred_on", end);
    setRestoreBusy(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    router.refresh();
  }

  function addKeywordFilter() {
    const v = newKeywordFilter.trim();
    if (!v) return;
    if (!savedKeywordFilters.includes(v)) {
      setSavedKeywordFilters((prev) => [...prev, v]);
    }
    if (!activeKeywordFilters.includes(v)) {
      setActiveKeywordFilters((prev) => [...prev, v]);
    }
    setNewKeywordFilter("");
  }

  function toggleKeywordFilter(v: string) {
    setActiveKeywordFilters((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );
  }

  function removeKeywordFilter(v: string) {
    setSavedKeywordFilters((prev) => prev.filter((x) => x !== v));
    setActiveKeywordFilters((prev) => prev.filter((x) => x !== v));
  }

  function suggestedDupDeleteIds(groups: DuplicateTransactionGroup[]): Set<string> {
    const s = new Set<string>();
    for (const g of groups) {
      for (let i = 1; i < g.members.length; i++) {
        s.add(g.members[i].id);
      }
    }
    return s;
  }

  useEffect(() => {
    if (!dupModalOpen) return;
    const groups =
      dupScope === "income"
        ? filterIncomeDuplicateGroups(duplicateGroups)
        : duplicateGroups;
    setDupDeleteIds(suggestedDupDeleteIds(groups));
    // Re-seed only when opening or switching scope — not when duplicateGroups changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupModalOpen, dupScope]);

  function openDupModal(nextScope: "all" | "income") {
    setDupScope(nextScope);
    setDupModalOpen(true);
  }

  function resetDupSelection() {
    setDupDeleteIds(suggestedDupDeleteIds(activeDupGroups));
  }

  function toggleDupDeleteId(id: string, checked: boolean) {
    setDupDeleteIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function validateDupDeletes(): string | null {
    for (const g of activeDupGroups) {
      const remaining = g.members.filter((m) => !dupDeleteIds.has(m.id));
      if (remaining.length === 0) {
        const hint = g.members[0].raw_description.trim().slice(0, 48);
        return `Each duplicate set must keep at least one copy (check "${hint}${hint.length >= 48 ? "…" : ""}").`;
      }
    }
    return null;
  }

  async function deleteMarkedDuplicates() {
    const ids = [...dupDeleteIds];
    if (ids.length === 0) return;
    const v = validateDupDeletes();
    if (v) {
      setError(v);
      return;
    }
    const noun =
      dupScope === "income"
        ? `duplicate income transaction${ids.length === 1 ? "" : "s"}`
        : `duplicate transaction${ids.length === 1 ? "" : "s"}`;
    if (
      !window.confirm(
        `Permanently delete ${ids.length} ${noun}? This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    setDupBusy(true);
    const supabase = createClient();
    const CHUNK = 500;
    let lastErr: string | null = null;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { error: delError } = await supabase
        .from("transactions")
        .delete()
        .in("id", chunk)
        .eq("household_id", householdId);
      if (delError) {
        lastErr = delError.message;
        break;
      }
    }
    setDupBusy(false);
    if (lastErr) {
      setError(lastErr);
      return;
    }
    const idSet = new Set(ids);
    setRows((prev) =>
      dedupeTransactionsById(prev.filter((r) => !idSet.has(r.id))),
    );
    setDupDeleteIds(new Set());
    router.refresh();
  }

  const sortedCats = sortCategoriesForPicker(categories);

  const uncategorizedCount = uniqueRows.filter(
    (r) => r.category_id == null,
  ).length;
  const creditsWithoutIncomeTag = uniqueRows.filter(
    (r) => r.amount > 0 && r.income_treatment == null,
  ).length;

  async function runAiCategorizeUncategorized() {
    setAiMessage(null);
    setAiBusy(true);
    let total = 0;
    const BATCH = 100;
    let rounds = 0;
    const maxRounds = 20;
    while (rounds < maxRounds) {
      const r = await requestAutoCategorize();
      rounds += 1;
      if (!r.ok) {
        setAiBusy(false);
        if (r.code === "NO_AI_KEY") {
          setAiMessage(
            "Add OPENAI_API_KEY to your server .env.local to enable AI categorization.",
          );
        } else {
          setAiMessage(r.error);
        }
        return;
      }
      total += r.updated;
      if (r.updated === 0) break;
      if ((r.considered ?? 0) < BATCH) break;
    }
    setAiBusy(false);
    setAiMessage(
      total === 0
        ? "No changes. Either every transaction already has a category, or the model did not match any row to your categories."
        : `Assigned categories to ${total} transaction${total === 1 ? "" : "s"} (up to ${BATCH} per request). Run again if more are uncategorized.`,
    );
    // Always sync category_id from DB into client state. This fixes stale state
    // where a previous run updated the DB but router.refresh() failed to propagate it.
    {
      const supabase = createClient();
      const { data: freshCats } = await supabase
        .from("transactions")
        .select("id, category_id")
        .eq("household_id", householdId)
        .not("category_id", "is", null);
      if (freshCats && freshCats.length > 0) {
        const catMap = new Map(
          freshCats.map((r) => [String(r.id), r.category_id ? String(r.category_id) : null]),
        );
        setRows((prev) =>
          prev.map((row) => {
            const newCat = catMap.get(row.id);
            return newCat !== undefined ? { ...row, category_id: newCat } : row;
          }),
        );
      }
    }
    router.refresh();
  }

  async function runAiClassifyIncome() {
    setAiIncomeMessage(null);
    setAiIncomeBusy(true);
    const r = await requestClassifyIncome();
    setAiIncomeBusy(false);
    if (!r.ok) {
      if (r.code === "NO_AI_KEY") {
        setAiIncomeMessage(
          "Add OPENAI_API_KEY to .env.local to enable AI income tagging.",
        );
      } else {
        setAiIncomeMessage(r.error);
      }
      return;
    }
    setAiIncomeMessage(
      r.message ?? `Tagged ${r.updated} credit${r.updated === 1 ? "" : "s"}.`,
    );
    router.refresh();
  }

  const editMatchCount = editingTx
    ? uniqueRows.filter(
        (t) => t.normalized_description === editingTx.normalized_description,
      ).length
    : 0;

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Transactions
          </h1>
          <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
            Expenses are negative and income is positive. Category rules and CSV
            hints run on import;{" "}
            <a
              href="/settings/rules"
              className="font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-200"
            >
              Income rules
            </a>{" "}
            and AI decide which credits count on the Overview. Configure{" "}
            <span className="font-mono text-xs">OPENAI_API_KEY</span> for AI
            tools. Use the buttons below to import a CSV, review duplicates, or
            add a transaction — each opens in a dialog.
          </p>
        </div>
        {accounts.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
            Add at least one account in{" "}
            <a
              href="/settings/general"
              className="font-semibold text-amber-900 underline dark:text-amber-200"
            >
              Settings → General
            </a>{" "}
            before importing or adding transactions.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCsvImportModalOpen(true)}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Import from CSV
          </button>
          <button
            type="button"
            onClick={() => openDupModal("all")}
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-950 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
          >
            {duplicateGroups.length > 0
              ? `Review duplicates (${duplicateGroups.length})`
              : "Review duplicates"}
          </button>
          {incomeDuplicateGroups.length > 0 ? (
            <button
              type="button"
              onClick={() => openDupModal("income")}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-950 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60"
            >
              Income duplicates ({incomeDuplicateGroups.length})
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setAddTxModalOpen(true)}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Add transaction
          </button>
        </div>
      </div>

      <TransactionEditModal
        transaction={editingTx}
        householdId={householdId}
        categories={categories}
        accounts={accounts}
        plans={plans}
        matchCount={editMatchCount}
        ledgerArchiveColumnAvailable={ledgerArchiveColumnAvailable}
        onClose={() => setEditingTx(null)}
        onSaved={() => router.refresh()}
      />

      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <section className="max-w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <div className="flex flex-col gap-3 border-b border-zinc-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Ledger (
              {ledgerSearch.trim()
                ? `${filteredRows.length} of ${uniqueRows.length}`
                : uniqueRows.length}
              )
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Click a row to open details. Use Delete on the right to remove a
              row without opening it.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => void runAiCategorizeUncategorized()}
              disabled={aiBusy || uncategorizedCount === 0}
              className="shrink-0 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-100 dark:hover:bg-violet-950/60"
            >
              {aiBusy
                ? "Analyzing…"
                : `AI: categorize (${uncategorizedCount})`}
            </button>
            <button
              type="button"
              onClick={() => void runAiClassifyIncome()}
              disabled={
                aiIncomeBusy || creditsWithoutIncomeTag === 0 || aiBusy
              }
              className="shrink-0 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-100 dark:hover:bg-sky-950/60"
            >
              {aiIncomeBusy
                ? "Tagging…"
                : `AI: income tags (${creditsWithoutIncomeTag})`}
            </button>
            {ledgerArchiveColumnAvailable ? (
              <button
                type="button"
                onClick={() => void archiveAllNonPlaidLedger()}
                disabled={
                  archiveBusy ||
                  nonPlaidLedgerActiveCount === 0 ||
                  loading ||
                  aiBusy ||
                  aiIncomeBusy
                }
                title="Hide every transaction that is not linked to Plaid (CSV/manual only). Restore from Archived below."
                className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
              >
                {archiveBusy
                  ? "Archiving…"
                  : `Archive non-Plaid (${nonPlaidLedgerActiveCount})`}
              </button>
            ) : null}
          </div>
        </div>
        <div className="border-b border-zinc-100 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/50">
          <label htmlFor="ledger-search" className="sr-only">
            Search transactions
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="ledger-search"
              type="search"
              value={ledgerSearch}
              onChange={(e) => setLedgerSearch(e.target.value)}
              placeholder="Search description, notes, category, date, amount…"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-500/25"
            />
            {ledgerSearch.trim() ? (
              <button
                type="button"
                onClick={() => setLedgerSearch("")}
                className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                Clear
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            Multiple words narrow the list: each term must appear somewhere in
            the row (descriptions, notes, category, date, or amount).
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select
              value={ledgerCategoryFilter}
              onChange={(e) => setLedgerCategoryFilter(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 shadow-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="">All categories</option>
              <option value="__uncategorized__">Uncategorized</option>
              {sortedCategoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatCategoryLabel(c, categories)}
                </option>
              ))}
            </select>
            <select
              value={ledgerAccountFilter}
              onChange={(e) => setLedgerAccountFilter(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 shadow-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="">All accounts</option>
              <option value="__no_account__">No account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              {feedOnlyAccountNames.map((name) => (
                <option key={name} value={`__feed_name__:${name}`}>
                  {name} (bank feed)
                </option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 shadow-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100">
              <input
                type="checkbox"
                checked={businessExpenseOnly}
                onChange={(e) => setBusinessExpenseOnly(e.target.checked)}
                className="rounded border-zinc-300 dark:border-zinc-600"
              />
              Business expenses only
            </label>
            <div className="sm:col-span-2 lg:col-span-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKeywordFilter}
                  onChange={(e) => setNewKeywordFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addKeywordFilter();
                    }
                  }}
                  placeholder="Save custom keyword filter (e.g. venmo)"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                />
                <button
                  type="button"
                  onClick={addKeywordFilter}
                  className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
          {savedKeywordFilters.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {savedKeywordFilters.map((kw) => {
                const active = activeKeywordFilters.includes(kw);
                return (
                  <span
                    key={kw}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] ${
                      active
                        ? "border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-100"
                        : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleKeywordFilter(kw)}
                      className="font-medium"
                      title={active ? "Disable filter" : "Enable filter"}
                    >
                      {kw}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeKeywordFilter(kw)}
                      className="text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400"
                      title="Delete saved keyword"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
        {aiMessage ? (
          <p
            className="border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-300"
            role="status"
          >
            {aiMessage}
          </p>
        ) : null}
        {aiIncomeMessage ? (
          <p
            className="border-b border-zinc-100 bg-sky-50/80 px-4 py-2 text-xs text-sky-900 dark:border-zinc-800 dark:bg-sky-950/40 dark:text-sky-100"
            role="status"
          >
            {aiIncomeMessage}
          </p>
        ) : null}
        {uniqueRows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No transactions yet. Add one above, or sync a linked bank on{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Settings → Bank
            </span>
            .
          </p>
        ) : filteredRows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No transactions match{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              &quot;{ledgerSearch.trim()}&quot;
            </span>
            .{" "}
            <button
              type="button"
              onClick={() => setLedgerSearch("")}
              className="font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-200"
            >
              Clear search
            </button>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs sm:text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/70 dark:text-zinc-400 sm:text-xs">
                <tr>
                  <th className="whitespace-nowrap px-2 py-2 sm:px-3">Date</th>
                  <th className="px-2 py-2 sm:px-3">Description</th>
                  <th className="max-w-[11rem] px-2 py-2 sm:max-w-[13rem] sm:px-3">
                    Account
                  </th>
                  <th className="max-w-[9rem] px-2 py-2 sm:max-w-[11rem] sm:px-3">
                    Category
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-right sm:px-3">
                    Amount
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-2 py-2 text-right sm:px-3"
                    aria-label="Actions"
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredRows.map((r) => {
                  const amt = parseAmount(r.amount);
                  const cat = r.categories;
                  const feedOnly = Boolean(r.plaid_feed_only);
                  const accountLabel =
                    r.account_name ??
                    (r.account_id ? accountNameById.get(r.account_id) ?? null : null);
                  return (
                    <tr
                      key={r.id}
                      tabIndex={0}
                      className={
                        feedOnly
                          ? "cursor-pointer bg-zinc-50/50 hover:bg-zinc-100/80 focus-visible:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-400 dark:bg-zinc-900/40 dark:hover:bg-zinc-800/60 dark:focus-visible:bg-zinc-800 dark:focus-visible:outline-zinc-500"
                          : "cursor-pointer hover:bg-zinc-50/80 focus-visible:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-400 dark:hover:bg-zinc-800/60 dark:focus-visible:bg-zinc-800 dark:focus-visible:outline-zinc-500"
                      }
                      onClick={() => void openRowForEdit(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void openRowForEdit(r);
                        }
                      }}
                    >
                      <td className="whitespace-nowrap px-2 py-2 text-zinc-600 dark:text-zinc-400 sm:px-3 sm:py-2.5">
                        {r.occurred_on}
                      </td>
                      <td className="min-w-0 px-2 py-2 sm:px-3 sm:py-2.5">
                        <div className="flex flex-wrap items-center gap-2 break-words font-medium text-zinc-900 dark:text-zinc-100">
                          <span className="min-w-0">{r.raw_description}</span>
                          {feedOnly ? (
                            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:bg-violet-950/80 dark:text-violet-200">
                              Bank feed
                            </span>
                          ) : null}
                          {r.receipts && r.receipts.length > 0 ? (
                            <ReceiptPopover receipts={r.receipts} />
                          ) : null}
                        </div>
                        {r.notes ? (
                          <p className="mt-1 text-xs leading-snug text-zinc-500 dark:text-zinc-400">
                            <span className="font-medium text-zinc-600 dark:text-zinc-400">
                              Notes:
                            </span>{" "}
                            {r.notes}
                          </p>
                        ) : null}
                        {amt > 0 ? (
                          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                            Overview income:{" "}
                            <span className="font-medium text-zinc-600 dark:text-zinc-300">
                              {r.income_treatment === "exclude"
                                ? "excluded"
                                : r.income_treatment === "include"
                                  ? "included"
                                  : "auto"}
                            </span>
                          </p>
                        ) : null}
                      </td>
                      <td className="min-w-0 px-2 py-2 text-zinc-600 dark:text-zinc-400 sm:px-3 sm:py-2.5">
                        <span className="line-clamp-2 break-words">
                          {accountLabel ?? (
                            <span className="text-zinc-400 dark:text-zinc-500">—</span>
                          )}
                        </span>
                      </td>
                      <td className="min-w-0 px-2 py-2 sm:px-3 sm:py-2.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openRowForEdit(r);
                          }}
                          disabled={loading}
                          title="Change category"
                          className="w-full min-w-0 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-zinc-100/90 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800/80"
                        >
                          {cat ? (
                            <span className="inline-flex max-w-full items-center gap-1.5 sm:gap-2">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                                style={{
                                  backgroundColor: cat.color || "#94a3b8",
                                }}
                                aria-hidden
                              />
                              <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-300">
                                {categoryDisplayName(r)}
                              </span>
                            </span>
                          ) : (
                            <span className="text-violet-700 dark:text-violet-400">
                              Set category…
                            </span>
                          )}
                        </button>
                      </td>
                      <td
                        className={`whitespace-nowrap px-2 py-2 text-right text-xs font-medium tabular-nums sm:px-3 sm:py-2.5 sm:text-sm ${
                          amt < 0
                            ? "text-zinc-900 dark:text-zinc-100"
                            : amt > 0
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-zinc-500 dark:text-zinc-400"
                        }`}
                      >
                        {formatUsd(amt)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right sm:px-3 sm:py-2.5">
                        {feedOnly ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void openRowForEdit(r);
                            }}
                            disabled={loading}
                            className="text-xs font-medium text-violet-700 hover:text-violet-900 disabled:opacity-40 dark:text-violet-400 dark:hover:text-violet-200"
                          >
                            Edit / categorize
                          </button>
                        ) : (
                          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void openRowForEdit(r);
                              }}
                              disabled={loading}
                              className="text-xs font-medium text-violet-700 hover:text-violet-900 disabled:opacity-40 dark:text-violet-400 dark:hover:text-violet-200"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(r.id);
                              }}
                              disabled={loading}
                              className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-40 dark:text-red-400 dark:hover:text-red-300"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {ledgerArchiveColumnAvailable ? (
        <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
          <div className="flex flex-col gap-2 border-b border-zinc-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Archived (non-Plaid) · {archivedRows.length}
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Rows hidden from the ledger and dashboard. Plaid-linked lines are
                never archived here. Restore to bring a row back.
              </p>
            </div>
            {archivedRows.length > 0 ? (
              <div className="flex w-full max-w-2xl flex-col gap-3 sm:ml-auto sm:items-end">
                <div className="flex flex-wrap items-end justify-end gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      Restore through date
                    </label>
                    <input
                      type="date"
                      value={restoreThroughDate}
                      onChange={(e) => setRestoreThroughDate(e.target.value)}
                      disabled={restoreBusy || loading}
                      className="mt-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-800 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void restoreArchivedThroughSelectedDate()}
                    disabled={
                      restoreBusy ||
                      loading ||
                      !restoreThroughDate.trim() ||
                      restoreThroughMatchCount === 0
                    }
                    className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                  >
                    {restoreBusy
                      ? "Restoring…"
                      : `Restore ≤ date (${restoreThroughMatchCount})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => void restoreAllArchived()}
                    disabled={restoreBusy || loading}
                    className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                  >
                    {restoreBusy ? "Restoring…" : "Restore all"}
                  </button>
                </div>
                <div className="flex flex-wrap items-end justify-end gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      From
                    </label>
                    <input
                      type="date"
                      value={restoreRangeStart}
                      onChange={(e) => setRestoreRangeStart(e.target.value)}
                      disabled={restoreBusy || loading}
                      className="mt-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-800 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      Through
                    </label>
                    <input
                      type="date"
                      value={restoreRangeEnd}
                      onChange={(e) => setRestoreRangeEnd(e.target.value)}
                      disabled={restoreBusy || loading}
                      className="mt-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-800 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void restoreArchivedInDateRange()}
                    disabled={
                      restoreBusy ||
                      loading ||
                      !restoreRangeStart.trim() ||
                      !restoreRangeEnd.trim() ||
                      restoreRangeMatchCount === 0
                    }
                    className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                  >
                    {restoreBusy
                      ? "Restoring…"
                      : `Restore in range (${restoreRangeMatchCount})`}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          {archivedRows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No archived transactions.
            </p>
          ) : (
            <div className="max-h-[min(420px,50vh)] overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[480px] text-left text-xs sm:text-sm">
                <thead className="sticky top-0 border-b border-zinc-100 bg-zinc-50 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/70 dark:text-zinc-400 sm:text-xs">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2">Date</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">
                      Amount
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {archivedRows.map((r) => {
                    const amt = parseAmount(r.amount);
                    const cat = r.categories;
                    return (
                      <tr key={r.id} className="bg-zinc-50/50 dark:bg-zinc-950/30">
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">
                          {r.occurred_on}
                        </td>
                        <td className="max-w-[240px] px-3 py-2 text-zinc-800 dark:text-zinc-200">
                          <span className="line-clamp-2 font-medium">
                            {r.raw_description}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                          {cat ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/10"
                                style={{
                                  backgroundColor: cat.color || "#94a3b8",
                                }}
                                aria-hidden
                              />
                              {categoryDisplayName(r)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
                          {formatUsd(amt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => void restoreArchivedTransaction(r.id)}
                            disabled={restoreBusy || loading}
                            className="text-xs font-medium text-violet-700 hover:text-violet-900 disabled:opacity-40 dark:text-violet-400 dark:hover:text-violet-200"
                          >
                            Restore
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {dupModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex min-h-full items-start justify-center overflow-y-auto bg-zinc-950/55 p-4 backdrop-blur-[1px] dark:bg-black/65"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dup-modal-title"
          onClick={() => setDupModalOpen(false)}
        >
          <div
            className="relative my-8 w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-6 pt-14 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:pt-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setDupModalOpen(false)}
              className="absolute right-3 top-3 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              Close
            </button>
            <h2
              id="dup-modal-title"
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Duplicate transactions
            </h2>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Same match as CSV skip-duplicates: date, amount, and raw
              description. Use{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                Income only (credits)
              </span>{" "}
              to fix credits counted twice on the Overview. Search filters the
              list; keep at least one row per group.
            </p>
            {duplicateGroups.length > 0 ? (
              <div className="mt-3 space-y-1 text-sm" role="status">
                <p className="text-amber-900 dark:text-amber-200">
                  <span className="font-medium tabular-nums">{dupExtraCopies}</span>{" "}
                  extra cop{dupExtraCopies === 1 ? "y" : "ies"} in{" "}
                  <span className="font-medium tabular-nums">
                    {duplicateGroups.length}
                  </span>{" "}
                  group
                  {duplicateGroups.length === 1 ? "" : "s"} (all transactions).
                </p>
                {incomeDupExtraCopies > 0 ? (
                  <p className="text-emerald-900 dark:text-emerald-200">
                    <span className="font-medium tabular-nums">
                      {incomeDupExtraCopies}
                    </span>{" "}
                    extra income cop
                    {incomeDupExtraCopies === 1 ? "y" : "ies"} in{" "}
                    <span className="font-medium tabular-nums">
                      {incomeDuplicateGroups.length}
                    </span>{" "}
                    group
                    {incomeDuplicateGroups.length === 1 ? "" : "s"} — open{" "}
                    <button
                      type="button"
                      onClick={() => openDupModal("income")}
                      className="font-semibold text-emerald-950 underline decoration-emerald-600/50 hover:decoration-emerald-800 dark:text-emerald-200 dark:decoration-emerald-500/50"
                    >
                      Income duplicates
                    </button>
                    .
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 space-y-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <div
                className="flex flex-wrap gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-900/80"
                role="tablist"
                aria-label="Duplicate scope"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={dupScope === "all"}
                  onClick={() => setDupScope("all")}
                  className={`rounded-md px-3 py-2 text-xs font-semibold ${
                    dupScope === "all"
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }`}
                >
                  All transactions
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={dupScope === "income"}
                  onClick={() => setDupScope("income")}
                  className={`rounded-md px-3 py-2 text-xs font-semibold ${
                    dupScope === "income"
                      ? "bg-white text-emerald-900 shadow-sm ring-1 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-100 dark:ring-emerald-800"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }`}
                >
                  Income only (credits)
                </button>
              </div>
              <div>
                <label htmlFor="dup-search" className="sr-only">
                  Search duplicate groups
                </label>
                <input
                  id="dup-search"
                  type="search"
                  value={dupSearch}
                  onChange={(e) => setDupSearch(e.target.value)}
                  placeholder="Filter groups by keyword (description, date, category…)"
                  autoComplete="off"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-500/25"
                />
              </div>
              {duplicateGroups.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
                  No duplicate groups in your ledger (nothing shares date, amount,
                  and description with another row).
                </p>
              ) : dupScope === "income" &&
                incomeDuplicateGroups.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
                  No duplicate income (positive) transactions. Switch to{" "}
                  <span className="font-medium">All transactions</span> to
                  review debits.
                </p>
              ) : filteredDupGroups.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
                  No groups match your filter.{" "}
                  <button
                    type="button"
                    onClick={() => setDupSearch("")}
                    className="font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-200"
                  >
                    Clear search
                  </button>
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={resetDupSelection}
                      disabled={dupBusy}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    >
                      Reset selection (keep lowest id per group)
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteMarkedDuplicates()}
                      disabled={
                        dupBusy || loading || dupDeleteIds.size === 0
                      }
                      className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {dupBusy
                        ? "Deleting…"
                        : `Delete selected (${dupDeleteIds.size})`}
                    </button>
                  </div>
                  <div className="max-h-[min(50vh,28rem)] space-y-4 overflow-y-auto rounded-lg border border-zinc-100 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
                    {filteredDupGroups.map((g) => {
                      const m0 = g.members[0];
                      const amt = parseAmount(m0.amount);
                      return (
                        <div
                          key={g.key}
                          className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/20"
                        >
                          <p className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                            <span>{g.members.length}× duplicate</span>
                            {amt > 0 ? (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
                                Income
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {m0.occurred_on} · {formatUsd(amt)}
                          </p>
                          <p className="mt-1 line-clamp-3 text-sm text-zinc-700 dark:text-zinc-300">
                            {m0.raw_description}
                          </p>
                          <ul className="mt-3 space-y-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                            {g.members.map((m, idx) => {
                              const a = parseAmount(m.amount);
                              const cat = m.categories;
                              return (
                                <li key={`${g.key}:${m.id}:${idx}`}>
                                  <label className="flex cursor-pointer gap-3 rounded-md px-1 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/80">
                                    <input
                                      type="checkbox"
                                      checked={dupDeleteIds.has(m.id)}
                                      onChange={(e) =>
                                        toggleDupDeleteId(
                                          m.id,
                                          e.target.checked,
                                        )
                                      }
                                      disabled={dupBusy}
                                      className="mt-1 shrink-0"
                                    />
                                    <span className="min-w-0 flex-1 text-sm">
                                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                        {cat ? (
                                          <span className="inline-flex items-center gap-1.5">
                                            <span
                                              className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/10"
                                              style={{
                                                backgroundColor:
                                                  cat.color || "#94a3b8",
                                              }}
                                              aria-hidden
                                            />
                                            {categoryDisplayName(m)}
                                          </span>
                                        ) : (
                                          "Uncategorized"
                                        )}
                                      </span>
                                      {m.notes ? (
                                        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                                          Notes: {m.notes}
                                        </span>
                                      ) : null}
                                      <span className="mt-0.5 block text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                                        {formatUsd(a)}
                                      </span>
                                    </span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {addTxModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex min-h-full items-start justify-center overflow-y-auto bg-zinc-950/55 p-4 backdrop-blur-[1px] dark:bg-black/65"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-tx-modal-title"
          onClick={() => setAddTxModalOpen(false)}
        >
          <div
            className="relative my-8 w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-6 pt-14 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:pt-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setAddTxModalOpen(false)}
              className="absolute right-3 top-3 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              Close
            </button>
            <h2
              id="add-tx-modal-title"
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Add transaction
            </h2>
            <form
              onSubmit={handleAdd}
              className="mt-4 grid gap-4 sm:grid-cols-2"
            >
              {accounts.length > 0 ? (
                <div className="sm:col-span-2">
                  <label
                    htmlFor="tx-add-account"
                    className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                  >
                    Account
                  </label>
                  <select
                    id="tx-add-account"
                    value={importAccountId}
                    onChange={(e) => setImportAccountId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                  >
                    <option value="">Select account…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    Same default as CSV import. Manage in{" "}
                    <a
                      href="/settings/general"
                      className="font-medium text-violet-700 hover:underline dark:text-violet-400"
                    >
                      Settings → General
                    </a>
                    .
                  </p>
                </div>
              ) : null}
              <div>
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Amount
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                  placeholder="0.00"
                />
              </div>
              <div>
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Type
                </span>
                <div className="mt-2 flex rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-900/80">
                  <button
                    type="button"
                    onClick={() => setFlow("expense")}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
                      flow === "expense"
                        ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    Expense
                  </button>
                  <button
                    type="button"
                    onClick={() => setFlow("income")}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
                      flow === "income"
                        ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    Income
                  </button>
                </div>
              </div>
              <div>
                <label
                  htmlFor="tx-add-date"
                  className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                >
                  Date
                </label>
                <input
                  id="tx-add-date"
                  type="date"
                  value={occurredOn}
                  onChange={(e) => setOccurredOn(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="tx-add-desc"
                  className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                >
                  Description
                </label>
                <input
                  id="tx-add-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                  placeholder="e.g. Whole Foods, Paycheck, Electric bill"
                  maxLength={500}
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="tx-add-cat"
                  className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                >
                  Category
                </label>
                <select
                  id="tx-add-cat"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
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
              <div className="flex items-end sm:col-span-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  {loading ? "Saving…" : "Add transaction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {csvImportModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex min-h-full items-start justify-center overflow-y-auto bg-zinc-950/55 p-4 backdrop-blur-[1px] dark:bg-black/65"
          role="dialog"
          aria-modal="true"
          aria-labelledby="csv-import-dialog-title"
          onClick={() => setCsvImportModalOpen(false)}
        >
          <div
            className="relative my-8 w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-6 pt-14 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:pt-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setCsvImportModalOpen(false)}
              className="absolute right-3 top-3 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              Close
            </button>
            <h2
              id="csv-import-dialog-title"
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Import from bank CSV
            </h2>
            {accounts.length > 0 ? (
              <div className="mt-4">
                <label
                  htmlFor="tx-import-account-csv"
                  className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
                >
                  Account for this file
                </label>
                <select
                  id="tx-import-account-csv"
                  value={importAccountId}
                  onChange={(e) => setImportAccountId(e.target.value)}
                  className="mt-2 w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  <option value="">Select account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  Manage accounts in{" "}
                  <a
                    href="/settings/general"
                    className="font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400"
                  >
                    Settings → General
                  </a>
                  .
                </p>
              </div>
            ) : null}
            <div className="mt-4 max-h-[min(60vh,calc(100vh-10rem))] overflow-y-auto pr-0.5">
              <TransactionCsvImport
                householdId={householdId}
                userId={userId}
                categories={categories}
                accounts={accounts}
                importAccountId={importAccountId}
                embedded
                suppressHeading
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
