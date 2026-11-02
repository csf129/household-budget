import { describe, it, expect } from "vitest";
import { summarizeSeries, buildCategorySeries } from "./report-series";

describe("summarizeSeries", () => {
  it("flags a rising series as up", () => {
    const s = summarizeSeries([100, 100, 100, 200]);
    expect(s.current).toBe(200);
    expect(s.previous).toBe(100);
    expect(s.trailingAvg).toBe(100);
    expect(s.momDelta).toBe(100);
    expect(s.momPct).toBe(1);
    expect(s.trendDelta).toBe(100);
    expect(s.direction).toBe("up");
  });

  it("flags a falling series as down", () => {
    const s = summarizeSeries([200, 200, 200, 100]);
    expect(s.direction).toBe("down");
    expect(s.momDelta).toBe(-100);
    expect(s.momPct).toBe(-0.5);
  });

  it("treats a small change within the flat band as flat", () => {
    const s = summarizeSeries([100, 100, 100, 103]); // +3% vs trailing avg
    expect(s.direction).toBe("flat");
  });

  it("treats a brand-new cost (no prior history) as up with null momPct", () => {
    const s = summarizeSeries([0, 0, 0, 50]);
    expect(s.momPct).toBeNull();
    expect(s.trailingAvg).toBe(0);
    expect(s.direction).toBe("up");
  });

  it("handles a single data point", () => {
    const s = summarizeSeries([42]);
    expect(s.current).toBe(42);
    expect(s.previous).toBe(0);
    expect(s.momPct).toBeNull();
    expect(s.direction).toBe("up");
  });

  it("handles an empty series", () => {
    const s = summarizeSeries([]);
    expect(s.current).toBe(0);
    expect(s.direction).toBe("flat");
  });
});

describe("buildCategorySeries", () => {
  it("aligns series across buckets, carries color, and sorts by current spend", () => {
    const buckets: Map<string, { amount: number; color: string }>[] = [
      new Map([
        ["Groceries", { amount: 400, color: "#0a0" }],
        ["Electric", { amount: 120, color: "#00a" }],
      ]),
      new Map([
        ["Groceries", { amount: 420, color: "#0a0" }],
        ["Electric", { amount: 150, color: "#00a" }],
        ["Streaming", { amount: 30, color: "#a00" }], // appears only later
      ]),
    ];

    const rows = buildCategorySeries(buckets);

    // Sorted by current (latest bucket) spend: Groceries (420) > Electric (150) > Streaming (30).
    expect(rows.map((r) => r.name)).toEqual(["Groceries", "Electric", "Streaming"]);

    const electric = rows.find((r) => r.name === "Electric")!;
    expect(electric.series).toEqual([120, 150]);
    expect(electric.color).toBe("#00a");
    expect(electric.direction).toBe("up");

    const streaming = rows.find((r) => r.name === "Streaming")!;
    // Missing in the first bucket → backfilled with 0.
    expect(streaming.series).toEqual([0, 30]);
  });

  it("returns an empty list when no categories appear", () => {
    expect(buildCategorySeries([new Map(), new Map()])).toEqual([]);
  });
});
