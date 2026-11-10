import { describe, it, expect } from "vitest";
import {
  GRANULARITY_OPTIONS,
  bucketKeyToDateRange,
} from "./savings-projection-panel.helpers";

describe("GRANULARITY_OPTIONS", () => {
  it("lists the four granularities", () => {
    expect(GRANULARITY_OPTIONS.map((o) => o.value)).toEqual([
      "weekly",
      "monthly",
      "quarterly",
      "annual",
    ]);
  });
});

describe("bucketKeyToDateRange", () => {
  it("annual: full calendar year", () => {
    expect(bucketKeyToDateRange("2026", "annual")).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
  });

  it("quarterly: Q1 and Q4 bounds (with correct last day)", () => {
    expect(bucketKeyToDateRange("2026-Q1", "quarterly")).toEqual({
      start: "2026-01-01",
      end: "2026-03-31",
    });
    expect(bucketKeyToDateRange("2026-Q4", "quarterly")).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
  });

  it("monthly: first to last day, including a leap February", () => {
    expect(bucketKeyToDateRange("2026-02", "monthly")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
    expect(bucketKeyToDateRange("2028-02", "monthly")).toEqual({
      start: "2028-02-01",
      end: "2028-02-29",
    });
  });

  it("weekly: Sunday start to the following Saturday", () => {
    // 2026-03-08 is a Sunday
    expect(bucketKeyToDateRange("2026-03-08", "weekly")).toEqual({
      start: "2026-03-08",
      end: "2026-03-14",
    });
  });

  it("weekly: spans a month boundary", () => {
    // 2026-03-29 is a Sunday → week ends 2026-04-04
    expect(bucketKeyToDateRange("2026-03-29", "weekly")).toEqual({
      start: "2026-03-29",
      end: "2026-04-04",
    });
  });
});
