import { describe, it, expect } from "vitest";
import { sortCategories, sortPrimaryGroups } from "./categories-manager.helpers";
import type { CategoryRow, PrimaryCategoryGroupRow } from "@/types/finance";

const cat = (name: string, sort_order: number): CategoryRow =>
  ({ id: name, name, sort_order } as unknown as CategoryRow);

const group = (name: string, sort_order: number): PrimaryCategoryGroupRow =>
  ({ id: name, name, sort_order } as unknown as PrimaryCategoryGroupRow);

describe("sortCategories", () => {
  it("orders by sort_order ascending", () => {
    const out = sortCategories([cat("b", 2), cat("a", 1), cat("c", 3)]);
    expect(out.map((c) => c.name)).toEqual(["a", "b", "c"]);
  });

  it("breaks ties on sort_order by name", () => {
    const out = sortCategories([cat("Zed", 1), cat("Ada", 1), cat("Mid", 1)]);
    expect(out.map((c) => c.name)).toEqual(["Ada", "Mid", "Zed"]);
  });

  it("does not mutate the input array", () => {
    const input = [cat("b", 2), cat("a", 1)];
    const copy = [...input];
    sortCategories(input);
    expect(input).toEqual(copy);
  });
});

describe("sortPrimaryGroups", () => {
  it("orders by sort_order, then name", () => {
    const out = sortPrimaryGroups([
      group("Wants", 2),
      group("Needs", 1),
      group("Bills", 1),
    ]);
    expect(out.map((g) => g.name)).toEqual(["Bills", "Needs", "Wants"]);
  });
});
