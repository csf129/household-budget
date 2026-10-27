import Link from "next/link";
import type { CreditCardView } from "@/types/credit-card";
import type { CardLastPayment } from "@/lib/credit-card-last-payment";

function money(n: number | null, currency?: string | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function paidOn(iso: string): string {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Overview card: what each linked credit card owes right now and the last
 * payment made toward it. Balances come from Plaid's current balance; the
 * payment is found in the synced transaction feed (see credit-card-last-payment).
 */
export function DashboardCreditCards({
  cards,
  lastPayments,
}: {
  cards: CreditCardView[];
  lastPayments: Map<string, CardLastPayment>;
}) {
  const active = cards.filter((c) => c.status !== "cancelled");
  if (active.length === 0) return null;
  const totalOwed = active.reduce((s, c) => s + (c.currentBalance ?? 0), 0);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Credit cards
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Total owed{" "}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">{money(totalOwed)}</span>
        </p>
      </div>
      <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {active.map((c) => {
          const p = lastPayments.get(c.id);
          return (
            <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {c.name}
                  {c.mask ? <span className="text-zinc-500 dark:text-zinc-400"> ·•••{c.mask}</span> : null}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {p ? `Last payment ${money(p.amount, c.isoCurrencyCode)} on ${paidOn(p.on)}` : "No payment found yet"}
                </p>
              </div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {money(c.currentBalance, c.isoCurrencyCode)}
              </p>
            </li>
          );
        })}
      </ul>
      <Link
        href="/credit-cards"
        className="mt-3 inline-block text-xs font-medium text-violet-600 underline dark:text-violet-400"
      >
        Manage credit cards
      </Link>
    </section>
  );
}
