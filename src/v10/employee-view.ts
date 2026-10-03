import type { EmployeeView, HrsObservationAdapter } from "./types.js";

/** Converts a runtime adapter into the small, stable Web API representation. */
export function buildEmployeeViews(adapter: HrsObservationAdapter): EmployeeView[] {
  return adapter.listEmployees().map((employee) => ({
    ...employee,
    source: "deterministic-fixture",
  }));
}
