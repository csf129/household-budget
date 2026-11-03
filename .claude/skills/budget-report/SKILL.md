---
name: budget-report
description: >-
  Generate a visual household budget report on command. Pulls live data from
  this app (income, spending, month-over-month trends, bills that went up or
  down, car costs, credit cards, savings plans) and builds a scrollable HTML
  Artifact that ends with a prioritized deep-dive into where the household can
  save the most money with the least effort. Use whenever the user asks for a
  budget report, spending report, financial summary, "where can we save money",
  "how are we doing this month", or invokes /budget-report.
---

# Budget report

Builds a single scrollable HTML **Artifact** summarizing the household's money
and ending with a ranked "where to save" plan. Data comes from a dedicated,
secret-protected endpoint (`GET /api/report`) assembled by
`src/lib/report-data.ts`, so the numbers match the app's dashboard and email
summary.

## How it fits together

- `GET /api/report` (`src/app/api/report/route.ts`) returns the full
  `ReportData` JSON (`src/types/report.ts`). Auth is the cron/automation secret.
- `scripts/fetch-report.mjs` calls that endpoint, reading `CRON_SECRET` and the
  base URL **from the environment itself** and writing JSON to a file. The
  secret never appears on the command line or in the transcript — do not try to
  print, read, or pass it yourself.

## Steps

1. **Pick options.** Default to 6 complete months of history. Honor the user if
   they ask for a different window (2–12) or a specific household.

2. **Make sure the app is reachable.** The script hits `http://localhost:3000`
   by default (override with `REPORT_BASE_URL`). If no dev server is running,
   start one with the `run` skill or `npm run dev` and wait until it responds.
   To target the deployed app instead, set `REPORT_BASE_URL` to its origin —
   that deployment must have the same `CRON_SECRET`.

3. **Fetch the data** into the scratchpad (not the repo):

   ```bash
   node scripts/fetch-report.mjs "<scratchpad>/report.json" 6
   ```

   Add a third argument (household id) only if the endpoint reports multiple
   households. On `CRON_SECRET is not set`, tell the user it must be in the
   app's local env file and stop — never invent or ask them to paste it here.

4. **Read the JSON** (`report.json`). Shape — see `src/types/report.ts`:
   `months[]` (oldest→newest, last = current complete month; each has
   `income`, `spending`, `net`), `totals` (current vs trailing average),
   `categories[]` (each with a `series`, `current`, `previous`, `momDelta`,
   `momPct`, `trendDelta`, and `direction` of `up`/`down`/`flat`),
   `creditCards[]`, `savingsPlans[]`, and `feedback[]` (household notes — see
   below). All money is USD; spending is a positive number.

5. **Build the report Artifact.** First load the `artifact-design` and
   `dataviz` skills, then publish a scrollable HTML page with these sections,
   in order:

   1. **Overview** — current month income, spending, net; how each compares to
      the trailing average (↑/↓ with %). One line on whether the household ran a
      surplus or deficit.
   2. **Income** — monthly income trend; call out any dip or jump.
   3. **Spending trends** — income-vs-spending by month (bar or line); the net
      line. Note the direction of total spend.
   4. **Where the money goes** — top categories this month with their
      month-over-month change; a small sparkline or the series per row.
   5. **Bills — up or down** — categories that behave like recurring bills
      (utilities such as electric / gas / propane / water, subscriptions &
      streaming, insurance, phone/internet). For each, show current vs prior and
      the `direction`. Lead with the ones that rose most.
   6. **Cars** — fuel/gas, auto insurance, and any vehicle categories, with
      their trend.
   7. **Credit cards** — per card: balance, utilization, payment due day, annual
      fee (and renewal month), points. Flag high utilization (>30%) and any fee
      that is not clearly earning its keep.
   8. **Savings** — each plan's progress toward target and whether it is ahead
      of or behind pace (`pace` < 0 = behind).
   9. **Where to save the most, easiest first** — the deep-dive (below).

6. **Open the Artifact** for the user and give a one-line summary plus the top
   two or three savings moves in chat.

## The savings deep-dive (the point of the report)

Rank concrete opportunities by **impact × ease**. Put the biggest, easiest wins
first — the changes the household can make this week that save the most.

Derive candidates from the data, e.g.:

- **Risen bills** — any `direction: "up"` bill or subscription; estimate the
  monthly saving as the increase over its trailing average (what going back to
  normal is worth).
- **Subscriptions** — recurring small charges; flag likely-unused or duplicate
  services. Easy to cancel, so rank ease high.
- **Credit cards** — high utilization (interest risk) and annual fees whose
  rewards don't obviously cover them.
- **Category creep** — categories well above their trailing average or (if the
  data carries budgets) over budget.

For each opportunity give: **what**, **estimated monthly $ saved**, **effort**
(easy / medium / hard), and a **one-line action**. Present them as a ranked list
or an impact-vs-effort quadrant (easy+high-impact wins highlighted), then a
short "do these first" shortlist with a rough total monthly saving.

Ground every number in the JSON. If a figure isn't in the data, say so rather
than guessing. Round dollars; don't imply false precision.

### Honor the household's notes (`feedback[]`)

`report.json` carries a `feedback[]` array: notes the household saved on earlier
reports, each with a `category` (the area it's about — matches a spending
category / opportunity name; `""` means a general, report-wide note) and a
`note` (their own words). These persist across reports and are the household's
own context, so treat them as **authoritative** when building the deep-dive:

- **Never** recommend cutting something a note says they can't or won't change
  (e.g. a prepaid commitment, a medical need, a kid's activity they're keeping).
- Respect plans already in motion and corrections ("we already cancelled this",
  "that charge is actually annual") — don't re-suggest them or double-count.
- Fold the constraint into the action instead of dropping the opportunity: if a
  bill is fixed until a prepaid term ends, note *when* it can be revisited
  rather than proposing to cancel it now.
- When a note explains an overage, reflect that in how you frame (or de-rank)
  that opportunity.

If you surface an opportunity that a note directly addresses, acknowledge the
note so the household sees they were heard. These are the same notes the in-app
report collects, so the artifact and the app stay consistent.

## Guardrails

- The report contains the household's private finances. Build and publish it as
  an Artifact (private by default); don't send it anywhere or expose it in a URL
  the user didn't ask for.
- Never read, echo, or hardcode `CRON_SECRET` or any service key. The fetch
  script is the only thing that touches the secret.
- Write the JSON and any scratch files to the scratchpad, not the repo.
