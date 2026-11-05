import { describe, it, expect } from "vitest";
import {
  dedupeTransactionsById,
  findDuplicateTransactionGroups,
  filterIncomeDuplicateGroups,
} from "./find-duplicate-transaction-groups";
import type { TransactionRow } from "@/types/finance";

/** Minimal valid TransactionRow; only the fields these functions read matter. */
function row(partial: Partial<TransactionRow> & { id: string }): TransactionRow {
  return {
    amount: -10,
    occurred_on: "2026-01-15",
    raw_description: "Coffee",
    normalized_description: "coffee",
    notes: null,
    account_id: null,
    bank_account_id: null,
    category_id: null,
    categories: null,
    income_treatment: null,
    ...partial,
  } as TransactionRow;
}

describe("dedupeTransactionsById", () => {
  it("keeps the first occurrence of each id", () => {
    const rows = [
      row({ id: "a", raw_description: "first" }),
      row({ id: "b" }),
      row({ id: "a", raw_description: "second" }),
    ];
    const out = dedupeTransactionsById(rows);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
    expect(out[0].raw_description).toBe("first");
  });
});

describe("findDuplicateTransactionGroups", () => {
  it("groups rows with the same date, amount, and raw description", () => {
    const groups = findDuplicateTransactionGroups([
      row({ id: "a", amount: -12.5, raw_description: "Market" }),
      row({ id: "b", amount: -12.5, raw_description: "Market" }),
      row({ id: "c", amount: -12.5, raw_description: "Other" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("does not group rows that differ by amount", () => {
    const groups = findDuplicateTransactionGroups([
      row({ id: "a", amount: -12.5 }),
      row({ id: "b", amount: -12.6 }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("collapses duplicate ids before grouping (no self-duplicate)", () => {
    const groups = findDuplicateTransactionGroups([
      row({ id: "a" }),
      row({ id: "a" }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("skips rows with non-finite amounts", () => {
    const groups = findDuplicateTransactionGroups([
      row({ id: "a", amount: NaN }),
      row({ id: "b", amount: NaN }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("sorts members within a group by id", () => {
    const groups = findDuplicateTransactionGroups([
      row({ id: "z", amount: 5, raw_description: "Pay" }),
      row({ id: "a", amount: 5, raw_description: "Pay" }),
    ]);
    expect(groups[0].members.map((m) => m.id)).toEqual(["a", "z"]);
  });
});

describe("filterIncomeDuplicateGroups", () => {
  it("keeps only groups whose amount is positive (income)", () => {
    const groups = findDuplicateTransactionGroups([
      row({ id: "a", amount: 100, raw_description: "Payroll" }),
      row({ id: "b", amount: 100, raw_description: "Payroll" }),
      row({ id: "c", amount: -40, raw_description: "Store" }),
      row({ id: "d", amount: -40, raw_description: "Store" }),
    ]);
    expect(groups).toHaveLength(2);
    const income = filterIncomeDuplicateGroups(groups);
    expect(income).toHaveLength(1);
    expect(income[0].members[0].amount).toBe(100);
  });
});
