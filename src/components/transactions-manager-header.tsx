/**
 * Presentational header for the Transactions screen: title, help text, the
 * "add an account first" warning, and the CSV / review-duplicates / add-
 * transaction toolbar. Pure — all behavior comes in through props, so it is
 * safe to render and reason about in isolation.
 */
type Props = {
  hasAccounts: boolean;
  duplicateCount: number;
  incomeDuplicateCount: number;
  onImportCsv: () => void;
  onReviewDuplicates: (scope: "all" | "income") => void;
  onAddTransaction: () => void;
};

export function TransactionsManagerHeader({
  hasAccounts,
  duplicateCount,
  incomeDuplicateCount,
  onImportCsv,
  onReviewDuplicates,
  onAddTransaction,
}: Props) {
  return (
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
      {!hasAccounts ? (
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
          onClick={onImportCsv}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Import from CSV
        </button>
        <button
          type="button"
          onClick={() => onReviewDuplicates("all")}
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-950 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
        >
          {duplicateCount > 0
            ? `Review duplicates (${duplicateCount})`
            : "Review duplicates"}
        </button>
        {incomeDuplicateCount > 0 ? (
          <button
            type="button"
            onClick={() => onReviewDuplicates("income")}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-950 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60"
          >
            Income duplicates ({incomeDuplicateCount})
          </button>
        ) : null}
        <button
          type="button"
          onClick={onAddTransaction}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Add transaction
        </button>
      </div>
    </div>
  );
}
