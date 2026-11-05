import { describe, it, expect } from "vitest";
import {
  parseAmount,
  transactionMatchesKeywordSearch,
  suggestedDupDeleteIds,
} from "./transactions-manager.helpers";
import type { DuplicateTransactionGroup } from "@/lib/find-duplicate-transaction-groups";
import type { TransactionRow } from "@/types/finance";

function row(partial: Partial<TransactionRow> & { id: string }): TransactionRow {
  return {
    amount: -10,
    occurred_on: "2026-01-15",
    raw_description: "Coffee Shop",
    normalized_description: "coffee shop",
    notes: null,
    account_id: null,
    bank_account_id: null,
    category_id: null,
    categories: null,
    income_treatment: null,
    ...partial,
  } as TransactionRow;
}

describe("parseAmount", () => {
  it("passes numbers through", () => {
    expect(parseAmount(12.5)).toBe(12.5);
    expect(parseAmount(-3)).toBe(-3);
  });
  it("parses numeric strings", () => {
    expect(parseAmount("12.50")).toBe(12.5);
    expect(parseAmount("-3")).toBe(-3);
  });
  it("returns NaN for non-numeric input", () => {
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount(null)).toBeNaN();
    expect(parseAmount(undefined)).toBeNaN();
  });
});

describe("transactionMatchesKeywordSearch", () => {
  it("matches everything for an empty/whitespace query", () => {
    expect(transactionMatchesKeywordSearch(row({ id: "a" }), "")).toBe(true);
    expect(transactionMatchesKeywordSearch(row({ id: "a" }), "   ")).toBe(true);
  });

  it("requires every token to appear (AND), case-insensitively", () => {
    const r = row({ id: "a", raw_description: "Blue Bottle Coffee" });
    expect(transactionMatchesKeywordSearch(r, "blue coffee")).toBe(true);
    expect(transactionMatchesKeywordSearch(r, "BLUE COFFEE")).toBe(true);
    expect(transactionMatchesKeywordSearch(r, "blue tea")).toBe(false);
  });

  it("searches across tokens that live in different fields", () => {
    const r = row({
      id: "a",
      raw_description: "WHOLEFDS",
      notes: "weekly groceries",
      categories: {
        name: "Food",
        color: null,
        primary_group: { slug: "essentials", name: "Essentials" },
      },
    });
    // one token from notes, one from category, one from primary group
    expect(transactionMatchesKeywordSearch(r, "groceries food essentials")).toBe(
      true,
    );
  });

  it("matches on amount and date text", () => {
    const r = row({ id: "a", amount: -42.5, occurred_on: "2026-03-09" });
    expect(transactionMatchesKeywordSearch(r, "42.5")).toBe(true);
    expect(transactionMatchesKeywordSearch(r, "2026-03")).toBe(true);
  });
});

describe("suggestedDupDeleteIds", () => {
  const group = (key: string, ids: string[]): DuplicateTransactionGroup => ({
    key,
    members: ids.map((id) => row({ id })),
  });

  it("keeps the first member and suggests deleting the rest", () => {
    const ids = suggestedDupDeleteIds([group("k1", ["a", "b", "c"])]);
    expect([...ids].sort()).toEqual(["b", "c"]);
  });

  it("suggests nothing for a single-member group", () => {
    const ids = suggestedDupDeleteIds([group("k1", ["a"])]);
    expect(ids.size).toBe(0);
  });

  it("spans multiple groups", () => {
    const ids = suggestedDupDeleteIds([
      group("k1", ["a", "b"]),
      group("k2", ["c", "d", "e"]),
    ]);
    expect([...ids].sort()).toEqual(["b", "d", "e"]);
  });

  it("returns an empty set for no groups", () => {
    expect(suggestedDupDeleteIds([]).size).toBe(0);
  });
});
