import { describe, it, expect } from "vitest";
import { formatAlertDate, formatUsd } from "./alerts-inbox.helpers";

describe("formatAlertDate", () => {
  it("formats a date-only ISO string as its own calendar day (no UTC shift)", () => {
    // Appends T00:00:00 so it parses as local midnight — not shifted a day back.
    expect(formatAlertDate("2026-03-09")).toBe("Mar 9, 2026");
  });
});

describe("formatUsd", () => {
  it("formats the magnitude (absolute value) as USD", () => {
    expect(formatUsd(120)).toBe("$120.00");
    expect(formatUsd(-120)).toBe("$120.00");
    expect(formatUsd(0)).toBe("$0.00");
  });
});
