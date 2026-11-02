#!/usr/bin/env node
// Fetch the household budget report JSON from the running app and write it to a
// file. Reads CRON_SECRET and the base URL from the environment (loaded from the
// local env file INSIDE this script) so the secret never has to appear on the
// command line or in an agent transcript.
//
// Usage: node scripts/fetch-report.mjs <out.json> [months] [householdId]

import { writeFileSync } from "node:fs";

// Load the local env file so CRON_SECRET is available when the agent's shell
// did not export it. Node 20.12+ / 22 has process.loadEnvFile.
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    // Not present, or env already provided by the parent shell — fine either way.
  }
}

const outPath = process.argv[2];
if (!outPath) {
  console.error("Usage: node scripts/fetch-report.mjs <out.json> [months] [householdId]");
  process.exit(2);
}
const months = process.argv[3] ?? "6";
const householdId = process.argv[4] ?? "";

const secret = process.env.CRON_SECRET?.trim();
if (!secret) {
  console.error(
    "CRON_SECRET is not set. Add it to the app's local env file, then retry.",
  );
  process.exit(1);
}

const base = (process.env.REPORT_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const qs = new URLSearchParams({ months });
if (householdId) qs.set("householdId", householdId);
const target = `${base}/api/report?${qs.toString()}`;

try {
  const res = await fetch(target, { headers: { authorization: `Bearer ${secret}` } });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Request failed (${res.status}) for ${base}/api/report: ${text.slice(0, 500)}`);
    process.exit(1);
  }
  writeFileSync(outPath, text);

  // Print a short, secret-free summary so the caller can sanity-check.
  let summary = `${text.length} bytes`;
  try {
    const j = JSON.parse(text);
    summary =
      `household=${j.householdName} months=${j.months?.length} ` +
      `categories=${j.categories?.length} cards=${j.creditCards?.length} ` +
      `plans=${j.savingsPlans?.length}`;
  } catch {
    // leave byte-count summary
  }
  console.log(`Wrote ${outPath} — ${summary}`);
} catch (err) {
  console.error(`Could not reach ${base}/api/report: ${err?.message ?? err}`);
  console.error("Is the dev server running (npm run dev)? Is REPORT_BASE_URL correct?");
  process.exit(1);
}
