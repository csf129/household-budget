import type { SummarySections } from "@/types/email-summary";

export type CategoryRow = { name: string; amount: number; color: string };
export type TransactionRow = {
  occurred_on: string;
  normalized_description: string;
  amount: number;
  category: string | null;
};
export type BudgetRow = {
  name: string;
  spent: number;
  budget: number;
};
export type SavingsPlanRow = {
  name: string;
  saved: number;
  target: number;
};
export type CardReminderRow = {
  cardName: string;
  kind: "payment_due" | "fee_renewal";
  date: string;
  daysUntil: number;
};

export type SummaryData = {
  householdName: string;
  periodLabel: string;
  sections: SummarySections;
  // income_spending
  totalIncome: number;
  totalSpending: number;
  // category_breakdown
  categoryRows: CategoryRow[];
  // budget_progress
  budgetRows: BudgetRow[];
  // top_transactions
  topTransactions: TransactionRow[];
  // business_expenses
  businessExpenseCount: number;
  businessExpenseTotal: number;
  businessMissingReceiptsCount: number;
  // savings_plans
  savingsPlanRows: SavingsPlanRow[];
  // card_reminders
  cardReminderRows: CardReminderRow[];
  // ai_insights
  aiInsights: string;
};

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function progressBar(pct: number, color = "#6d28d9"): string {
  const clamped = Math.min(100, Math.max(0, pct));
  const barColor = pct > 100 ? "#dc2626" : color;
  return `
    <div style="background:#f4f4f5;border-radius:4px;height:8px;overflow:hidden;margin-top:4px;">
      <div style="background:${barColor};height:8px;width:${clamped}%;border-radius:4px;"></div>
    </div>`;
}

function sectionHeader(title: string): string {
  return `
    <tr><td style="padding:24px 0 8px;">
      <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#71717a;">${title}</p>
      <div style="margin-top:6px;height:1px;background:#e4e4e7;"></div>
    </td></tr>`;
}

export function buildSummaryEmail(data: SummaryData): string {
  const {
    householdName,
    periodLabel,
    sections,
    totalIncome,
    totalSpending,
    categoryRows,
    budgetRows,
    topTransactions,
    businessExpenseCount,
    businessExpenseTotal,
    businessMissingReceiptsCount,
    savingsPlanRows,
    cardReminderRows,
    aiInsights,
  } = data;

  const net = totalIncome - totalSpending;
  const netColor = net >= 0 ? "#16a34a" : "#dc2626";
  const netLabel = net >= 0 ? "Surplus" : "Deficit";

  let body = "";

  // ── AI Insights ────────────────────────────────────────────────
  if (sections.ai_insights && aiInsights) {
    body += sectionHeader("AI Spending Insights");
    const bulletHtml = aiInsights
      .split("\n")
      .filter(Boolean)
      .map((line) =>
        line.startsWith("•")
          ? `<p style="margin:6px 0;font-size:13px;color:#18181b;padding-left:4px;">• ${line.slice(1).trim()}</p>`
          : `<p style="margin:8px 0 2px;font-size:13px;color:#18181b;">${line}</p>`,
      )
      .join("");
    body += `
    <tr><td>
      <div style="background:#f9f7ff;border-left:3px solid #7c3aed;border-radius:4px;padding:12px 16px;">
        ${bulletHtml}
      </div>
    </td></tr>`;
  }

  // ── Income & Spending ─────────────────────────────────────────
  if (sections.income_spending) {
    body += sectionHeader("Income &amp; Spending");
    body += `
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td width="33%" style="padding:12px 8px 12px 0;vertical-align:top;">
            <p style="margin:0 0 4px;font-size:11px;color:#71717a;font-weight:500;">Income</p>
            <p style="margin:0;font-size:22px;font-weight:700;color:#16a34a;">${fmt(totalIncome)}</p>
          </td>
          <td width="33%" style="padding:12px 8px;vertical-align:top;">
            <p style="margin:0 0 4px;font-size:11px;color:#71717a;font-weight:500;">Spending</p>
            <p style="margin:0;font-size:22px;font-weight:700;color:#18181b;">${fmt(totalSpending)}</p>
          </td>
          <td width="33%" style="padding:12px 0 12px 8px;vertical-align:top;">
            <p style="margin:0 0 4px;font-size:11px;color:#71717a;font-weight:500;">${netLabel}</p>
            <p style="margin:0;font-size:22px;font-weight:700;color:${netColor};">${fmt(Math.abs(net))}</p>
          </td>
        </tr>
      </table>
    </td></tr>`;
  }

  // ── Spending by Category ───────────────────────────────────────
  if (sections.category_breakdown && categoryRows.length > 0) {
    body += sectionHeader("Spending by Category");
    const maxAmt = Math.max(...categoryRows.map((r) => r.amount), 1);
    body += `<tr><td>`;
    for (const row of categoryRows.slice(0, 10)) {
      const pct = (row.amount / maxAmt) * 100;
      const barColor = row.color || "#6d28d9";
      body += `
        <div style="margin-bottom:10px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:13px;color:#18181b;">${row.name}</td>
              <td align="right" style="font-size:13px;font-weight:600;color:#18181b;white-space:nowrap;">${fmt(row.amount)}</td>
            </tr>
          </table>
          ${progressBar(pct, barColor)}
        </div>`;
    }
    body += `</td></tr>`;
  }

  // ── Budget Progress ────────────────────────────────────────────
  if (sections.budget_progress && budgetRows.length > 0) {
    body += sectionHeader("Budget Progress");
    body += `<tr><td>`;
    for (const row of budgetRows) {
      const pct = row.budget > 0 ? (row.spent / row.budget) * 100 : 0;
      const over = row.spent > row.budget;
      body += `
        <div style="margin-bottom:12px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:13px;color:#18181b;">${row.name}</td>
              <td align="right" style="font-size:12px;color:${over ? "#dc2626" : "#71717a"};white-space:nowrap;">
                ${fmt(row.spent)} / ${fmt(row.budget)}
              </td>
            </tr>
          </table>
          ${progressBar(pct)}
        </div>`;
    }
    body += `</td></tr>`;
  }

  // ── Top Transactions ───────────────────────────────────────────
  if (sections.top_transactions && topTransactions.length > 0) {
    body += sectionHeader("Top Transactions");
    body += `
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="6" style="border-collapse:collapse;">`;
    for (const tx of topTransactions.slice(0, 10)) {
      body += `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;vertical-align:top;">
            <p style="margin:0;font-size:13px;color:#18181b;">${tx.normalized_description}</p>
            <p style="margin:2px 0 0;font-size:11px;color:#71717a;">${tx.occurred_on}${tx.category ? ` · ${tx.category}` : ""}</p>
          </td>
          <td align="right" style="padding:8px 0;border-bottom:1px solid #f4f4f5;vertical-align:top;white-space:nowrap;">
            <p style="margin:0;font-size:13px;font-weight:600;color:#18181b;">${fmt(Math.abs(tx.amount))}</p>
          </td>
        </tr>`;
    }
    body += `</table></td></tr>`;
  }

  // ── Business Expenses ──────────────────────────────────────────
  if (sections.business_expenses) {
    body += sectionHeader("Business Expenses");
    body += `
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="33%" style="padding:12px 8px 12px 0;vertical-align:top;">
            <p style="margin:0 0 4px;font-size:11px;color:#71717a;font-weight:500;">Transactions</p>
            <p style="margin:0;font-size:22px;font-weight:700;color:#18181b;">${businessExpenseCount}</p>
          </td>
          <td width="33%" style="padding:12px 8px;vertical-align:top;">
            <p style="margin:0 0 4px;font-size:11px;color:#71717a;font-weight:500;">Total</p>
            <p style="margin:0;font-size:22px;font-weight:700;color:#18181b;">${fmt(businessExpenseTotal)}</p>
          </td>
          <td width="33%" style="padding:12px 0 12px 8px;vertical-align:top;">
            <p style="margin:0 0 4px;font-size:11px;color:#71717a;font-weight:500;">Missing Receipts</p>
            <p style="margin:0;font-size:22px;font-weight:700;color:${businessMissingReceiptsCount > 0 ? "#d97706" : "#16a34a"};">${businessMissingReceiptsCount}</p>
          </td>
        </tr>
      </table>
    </td></tr>`;
  }

  // ── Savings Plans ──────────────────────────────────────────────
  if (sections.savings_plans && savingsPlanRows.length > 0) {
    body += sectionHeader("Savings Plans");
    body += `<tr><td>`;
    for (const plan of savingsPlanRows) {
      const pct = plan.target > 0 ? (plan.saved / plan.target) * 100 : 0;
      body += `
        <div style="margin-bottom:12px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:13px;color:#18181b;">${plan.name}</td>
              <td align="right" style="font-size:12px;color:#71717a;white-space:nowrap;">
                ${fmt(plan.saved)} / ${fmt(plan.target)} (${Math.round(pct)}%)
              </td>
            </tr>
          </table>
          ${progressBar(pct)}
        </div>`;
    }
    body += `</td></tr>`;
  }

  // ── Credit Card Reminders ──────────────────────────────────────
  if (sections.card_reminders && cardReminderRows.length > 0) {
    body += sectionHeader("Credit Card Reminders");
    body += `
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="6" style="border-collapse:collapse;">`;
    for (const r of cardReminderRows) {
      const isUrgent = r.daysUntil <= 7;
      const accent = isUrgent ? "#dc2626" : "#71717a";
      const label =
        r.kind === "payment_due"
          ? r.daysUntil < 0
            ? `Payment ${Math.abs(r.daysUntil)} day(s) overdue`
            : `Payment due in ${r.daysUntil} day(s)`
          : `Annual fee renews in ${r.daysUntil} day(s) — cancel before this if unwanted`;
      body += `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;vertical-align:top;">
            <p style="margin:0;font-size:13px;color:#18181b;font-weight:600;">${r.cardName}</p>
            <p style="margin:2px 0 0;font-size:12px;color:${accent};">${label} · ${r.date}</p>
          </td>
        </tr>`;
    }
    body += `</table></td></tr>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${householdName} — ${periodLabel} Summary</title>
</head>
<body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;overflow:hidden;">

        <!-- Header -->
        <tr><td style="background:#18181b;padding:28px 32px;">
          <p style="margin:0;font-size:13px;font-weight:600;color:#a1a1aa;letter-spacing:.06em;text-transform:uppercase;">Household Budget</p>
          <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#ffffff;">${householdName}</p>
          <p style="margin:4px 0 0;font-size:14px;color:#71717a;">${periodLabel} Summary</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:8px 32px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${body}
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f4f4f5;padding:16px 32px;border-top:1px solid #e4e4e7;">
          <p style="margin:0;font-size:11px;color:#a1a1aa;text-align:center;">
            You're receiving this because email summaries are enabled for ${householdName}.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
