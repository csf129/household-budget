import { describe, it, expect } from "vitest";
import {
  expectedSavedByDate,
  daysBetweenStartAndEndExclusive,
} from "./savings-plan-math";

describe("daysBetweenStartAndEndExclusive", () => {
  it("counts whole days, end exclusive", () => {
    expect(
      daysBetweenStartAndEndExclusive(new Date(2026, 0, 1), new Date(2026, 0, 11)),
    ).toBe(10);
  });

  it("is negative when end precedes start", () => {
    expect(
      daysBetweenStartAndEndExclusive(new Date(2026, 0, 11), new Date(2026, 0, 1)),
    ).toBeLessThan(0);
  });
});

describe("expectedSavedByDate (linear pace, no recurring increment)", () => {
  const target = 1000;
  const start = "2026-01-01";
  const end = "2026-01-10"; // 10-day inclusive span

  it("expects nothing before the start date", () => {
    expect(
      expectedSavedByDate(target, start, end, null, null, new Date(2025, 11, 31)),
    ).toBe(0);
  });

  it("expects the full target on/after the end date", () => {
    expect(
      expectedSavedByDate(target, start, end, null, null, new Date(2026, 0, 10)),
    ).toBe(1000);
    expect(
      expectedSavedByDate(target, start, end, null, null, new Date(2026, 1, 1)),
    ).toBe(1000);
  });

  it("expects roughly half at the midpoint", () => {
    expect(
      expectedSavedByDate(target, start, end, null, null, new Date(2026, 0, 5)),
    ).toBe(500);
  });

  it("never exceeds the target", () => {
    const v = expectedSavedByDate(
      target,
      start,
      end,
      null,
      null,
      new Date(2026, 5, 1),
    );
    expect(v).toBeLessThanOrEqual(target);
  });

  it("returns 0 for an unparseable date", () => {
    expect(
      expectedSavedByDate(target, "bogus", end, null, null, new Date(2026, 0, 5)),
    ).toBe(0);
  });
});
