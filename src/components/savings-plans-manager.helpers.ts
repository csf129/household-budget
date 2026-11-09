import type { SavingsIncrementPeriod, SavingsPlanKind } from "@/types/finance";

/**
 * Pure helpers and the plan-save payload shape, extracted from
 * savings-plans-manager.tsx. No React, no state.
 */

export function kindLabel(k: SavingsPlanKind) {
  return k === "vacation" ? "Vacation" : "Project";
}

export const INCLUDE_PROJECTION_MIGRATION_FILE =
  "20260412100000_savings_plans_cadence_projection.sql";

export function isMissingIncludeInProjectionError(message: string): boolean {
  return message.toLowerCase().includes("include_in_projection");
}

export type PlanSavePayload = {
  household_id: string;
  title: string;
  plan_kind: SavingsPlanKind;
  target_amount: number;
  start_date: string;
  target_date: string;
  increment_amount: number | null;
  increment_period: SavingsIncrementPeriod | null;
  include_in_projection: boolean;
  notes: string | null;
};

export function withoutIncludeInProjection(
  p: PlanSavePayload,
): Omit<PlanSavePayload, "include_in_projection"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit include_in_projection from rest
  const { include_in_projection: _i, ...rest } = p;
  return rest;
}
