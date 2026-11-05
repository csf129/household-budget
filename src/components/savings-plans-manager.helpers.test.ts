import { describe, it, expect } from "vitest";
import {
  kindLabel,
  isMissingIncludeInProjectionError,
  withoutIncludeInProjection,
  type PlanSavePayload,
} from "./savings-plans-manager.helpers";

describe("kindLabel", () => {
  it("maps plan kinds to display labels", () => {
    expect(kindLabel("vacation")).toBe("Vacation");
    expect(kindLabel("project")).toBe("Project");
  });
});

describe("isMissingIncludeInProjectionError", () => {
  it("matches the include_in_projection column error, case-insensitively", () => {
    expect(
      isMissingIncludeInProjectionError(
        'column "include_in_projection" does not exist',
      ),
    ).toBe(true);
    expect(
      isMissingIncludeInProjectionError("COLUMN INCLUDE_IN_PROJECTION missing"),
    ).toBe(true);
  });
  it("ignores unrelated errors", () => {
    expect(isMissingIncludeInProjectionError("permission denied")).toBe(false);
  });
});

describe("withoutIncludeInProjection", () => {
  it("drops include_in_projection and keeps the rest", () => {
    const payload: PlanSavePayload = {
      household_id: "h1",
      title: "Trip",
      plan_kind: "vacation",
      target_amount: 1000,
      start_date: "2026-01-01",
      target_date: "2026-12-31",
      increment_amount: null,
      increment_period: null,
      include_in_projection: true,
      notes: null,
    };
    const out = withoutIncludeInProjection(payload);
    expect("include_in_projection" in out).toBe(false);
    expect(out.title).toBe("Trip");
    expect(out.target_amount).toBe(1000);
  });
});
