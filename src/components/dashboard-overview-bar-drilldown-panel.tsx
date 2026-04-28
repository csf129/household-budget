"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import type { IncomeRuleRow } from "@/lib/apply-income-rules";
import { overviewIncomeContribution } from "@/lib/dashboard-analytics";
import type { PeriodBucket } from "@/lib/dashboard-analytics";
import {
  listTransactionsForBucketBankTransfers,
  listTransactionsForBucketCreditCardPayments,
  listTransactionsForBucketIncome,
  listTransactionsForBucketPrimarySlug,
  listTransactionsForBucketSpending,
} from "@/lib/dashboard-overview-bucket-transactions";
import { TransactionEditModal } from "@/components/transaction-edit-modal";
import { formatUsd } from "@/lib/money";
import type { CategoryRow, TransactionRow } from "@/types/finance";

export type OverviewBarDrilldownSpec =
  | { kind: "income"; bucket: PeriodBucket }
  | { kind: "purchases"; bucket: PeriodBucket }
  | {
      kind: "bank_transfers";
      bucket: PeriodBucket;
      /** When set, list is restricted to this account (matches overview filter). */
      accountId: string | null;
      accountLabel?: string | null;
    }
  | { kind: "credit_card_payments"; bucket: PeriodBucket }
  | {
      kind: "primary";
      bucket: PeriodBucket;
      slug: string;
      title: string;
      barColor: string | null;
    };

type Props = {
  householdId: string;
  categories: CategoryRow[];
  transactions: TransactionRow[];
  spec: OverviewBarDrilldownSpec;
  incomeRules: IncomeRuleRow[];
  onClose: () => void;
};

export function DashboardOverviewBarDrilldownPanel({
  householdId,
  categories,
  transactions,
  spec,
  incomeRules,
  onClose,
}: Props) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [editingTx, setEditingTx] = useState<TransactionRow | null>(null);

  const filteredTx = useMemo(() => {
    switch (spec.kind) {
      case "income":
        return listTransactionsForBucketIncome(
          transactions,
          spec.bucket,
          incomeRules,
        );
      case "purchases":
        return listTransactionsForBucketSpending(transactions, spec.bucket);
      case "bank_transfers":
        return listTransactionsForBucketBankTransfers(
          transactions,
          spec.bucket,
          spec.accountId,
        );
      case "credit_card_payments":
        return listTransactionsForBucketCreditCardPayments(
          transactions,
          spec.bucket,
        );
      case "primary":
        return listTransactionsForBucketPrimarySlug(
          transactions,
          spec.bucket,
          spec.slug,
        );
    }
  }, [spec, transactions, incomeRules]);

  const listTotal = useMemo(() => {
    switch (spec.kind) {
      case "income":
        return filteredTx.reduce(
          (s, t) => s + overviewIncomeContribution(t, incomeRules),
          0,
        );
      case "purchases":
      case "credit_card_payments":
        return filteredTx.reduce((s, t) => s + -t.amount, 0);
      case "bank_transfers":
        if (spec.accountId != null) {
          return filteredTx.reduce((s, t) => s + t.amount, 0);
        }
        return filteredTx.reduce((s, t) => s + Math.abs(t.amount), 0);
      case "primary":
        return filteredTx.reduce((s, t) => s + t.amount, 0);
    }
  }, [spec, filteredTx, incomeRules]);

  const { title, totalHint, emptyHint } = useMemo(() => {
    const b = spec.bucket.label;
    switch (spec.kind) {
      case "income":
        return {
          title: `Income — ${b}`,
          totalHint: "in this period",
          emptyHint:
            "No income in this bucket matches the overview rules for the green bar.",
        };
      case "purchases":
        return {
          title: `Purchases & bills — ${b}`,
          totalHint: "spent in this period",
          emptyHint:
            "No purchases & bills in this bucket match the blue bar rules.",
        };
      case "bank_transfers": {
        const acct = spec.accountLabel?.trim();
        return {
          title:
            acct && spec.accountId
              ? `Bank transfers (${acct}) — ${b}`
              : `Bank transfers — ${b}`,
          totalHint:
            spec.accountId != null ? "net for this account" : "gross transfer volume",
          emptyHint:
            spec.accountId != null
              ? "No bank transfer activity on this account in this period."
              : "No bank transfer activity in this period.",
        };
      }
      case "credit_card_payments":
        return {
          title: `Credit card payments — ${b}`,
          totalHint: "paid to cards",
          emptyHint: "No card payment outflows in this period.",
        };
      case "primary":
        return {
          title: `${spec.title} — ${b}`,
          totalHint: "net in this period",
          emptyHint: "No transactions in this bucket for this primary category.",
        };
    }
  }, [spec]);

  const accentColor = useMemo(() => {
    switch (spec.kind) {
      case "income":
        return isDark ? "#22c55e" : "#16a34a";
      case "purchases":
        return isDark ? "#3b82f6" : "#2563eb";
      case "bank_transfers":
        return isDark ? "#94a3b8" : "#64748b";
      case "credit_card_payments":
        return isDark ? "#f97316" : "#c2410c";
      case "primary":
        return spec.barColor || "#7c3aed";
      default:
        return "#71717a";
    }
  }, [spec, isDark]);

  const editMatchCount = useMemo(() => {
    if (!editingTx) return 0;
    return transactions.filter(
      (t) => t.normalized_description === editingTx.normalized_description,
    ).length;
  }, [editingTx, transactions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editingTx) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editingTx]);

  function amountCellClass(t: TransactionRow): string {
    const base =
      "whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums ";
    switch (spec.kind) {
      case "income":
        return (
          base +
          "text-emerald-700 dark:text-emerald-400"
        );
      case "primary":
        if (!Number.isFinite(t.amount)) {
          return base + "text-zinc-900 dark:text-zinc-100";
        }
        return (
          base +
          (t.amount > 0
            ? "text-emerald-700 dark:text-emerald-400"
            : t.amount < 0
              ? "text-zinc-900 dark:text-zinc-100"
              : "text-zinc-500 dark:text-zinc-400")
        );
      case "bank_transfers":
        if (spec.accountId != null) {
          if (!Number.isFinite(t.amount)) {
            return base + "text-zinc-900 dark:text-zinc-100";
          }
          return (
            base +
            (t.amount > 0
              ? "text-emerald-700 dark:text-emerald-400"
              : t.amount < 0
                ? "text-red-600 dark:text-red-400"
                : "text-zinc-500 dark:text-zinc-400")
          );
        }
        return base + "text-zinc-900 dark:text-zinc-100";
      default:
        return base + "text-zinc-900 dark:text-zinc-100";
    }
  }

  function formatAmountCell(t: TransactionRow): string {
    switch (spec.kind) {
      case "purchases":
      case "income":
        return formatUsd(t.amount < 0 ? -t.amount : t.amount);
      case "credit_card_payments":
        return formatUsd(t.amount < 0 ? -t.amount : t.amount);
      case "bank_transfers":
        if (spec.accountId != null) {
          return formatUsd(t.amount);
        }
        return formatUsd(Math.abs(t.amount));
      case "primary":
        return formatUsd(t.amount);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="overview-bar-drill-title"
        className="flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 sm:px-5 dark:border-zinc-700 dark:bg-zinc-900">
          <h2
            id="overview-bar-drill-title"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-baseline gap-2">
            <span
              className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
              style={{ backgroundColor: accentColor }}
              aria-hidden
            />
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">All accounts</span>
              <span className="text-zinc-400 dark:text-zinc-600"> · </span>
              <span className="tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                {formatUsd(listTotal)}
              </span>
              <span className="text-zinc-500 dark:text-zinc-400"> {totalHint}</span>
            </p>
          </div>

          <div className="min-h-0 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/20">
            <div className="max-h-[min(520px,calc(95vh-220px))] overflow-y-auto">
              {filteredTx.length === 0 ? (
                <p className="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  {emptyHint}
                </p>
              ) : (
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-400">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="w-10 px-2 py-3" aria-hidden />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {filteredTx.map((t) => {
                      const cat = t.categories;
                      return (
                        <tr
                          key={t.id}
                          tabIndex={0}
                          role="button"
                          aria-label={`Edit transaction ${t.raw_description.slice(0, 40)}`}
                          className="cursor-pointer hover:bg-zinc-50/80 focus-visible:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-400 dark:hover:bg-zinc-800/60 dark:focus-visible:bg-zinc-800 dark:focus-visible:outline-zinc-500"
                          onClick={() => setEditingTx(t)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setEditingTx(t);
                            }
                          }}
                        >
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-600 dark:text-zinc-400">
                            {t.occurred_on}
                          </td>
                          <td className="max-w-[220px] px-4 py-3">
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                              {t.raw_description}
                            </span>
                            {t.notes ? (
                              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                {t.notes}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            {cat ? (
                              <span className="inline-flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/10"
                                  style={{
                                    backgroundColor: cat.color || "#94a3b8",
                                  }}
                                  aria-hidden
                                />
                                {cat.name}
                              </span>
                            ) : (
                              <span className="text-zinc-400 dark:text-zinc-500">—</span>
                            )}
                          </td>
                          <td className={amountCellClass(t)}>
                            {formatAmountCell(t)}
                          </td>
                          <td className="px-2 py-3 text-zinc-400 dark:text-zinc-500">›</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {filteredTx.length > 0 ? (
              <p className="border-t border-zinc-100 px-4 py-2 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                End of list
              </p>
            ) : null}
          </div>

          <p className="mt-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
            <span className="text-zinc-600 dark:text-zinc-400">Click a row to edit.</span>{" "}
            <Link
              href="/transactions"
              className="font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-200"
            >
              Open full ledger
            </Link>{" "}
            for bulk work.
          </p>
        </div>
      </div>

      {editingTx ? (
        <TransactionEditModal
          transaction={editingTx}
          householdId={householdId}
          categories={categories}
          matchCount={editMatchCount}
          onClose={() => setEditingTx(null)}
          onSaved={() => {
            setEditingTx(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
