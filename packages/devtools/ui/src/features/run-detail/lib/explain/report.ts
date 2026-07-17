/**
 * Runtime adapter for `TurnDecisionReport` payloads.
 *
 * The public contract says report collections are arrays, but Devtools can read
 * older local-runtime payloads or partially projected reports where Go encoded a
 * nil slice as `null`. This module is the narrow boundary that turns those
 * payloads back into the contract shape before the Explain UI asks array
 * questions such as `.some()`, `.filter()`, or `.map()`.
 */

import type {
  TurnDecisionCoverage,
  TurnDecisionReport,
  TurnSourceGroup,
} from "@/types";

type ArrayFieldKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends readonly unknown[] ? K : never;
}[keyof T];

type NullableReportArrays = Partial<{
  [K in Exclude<ArrayFieldKeys<TurnDecisionReport>, "source">]:
    | TurnDecisionReport[K]
    | null;
}>;

type RuntimeCoverage = Partial<Omit<TurnDecisionCoverage, "areas">> & {
  areas?: TurnDecisionCoverage["areas"] | null;
};

type RuntimeSourceGroup = Omit<TurnSourceGroup, "items"> & {
  items?: TurnSourceGroup["items"] | null;
};

/**
 * A `TurnDecisionReport` as it may arrive over the local Devtools JSON boundary.
 *
 * This keeps the strict public type visible while acknowledging the runtime
 * transport edge: empty collections can be `null` in older payloads. Keep this
 * type local to Devtools; package users should keep depending on
 * `TurnDecisionReport`.
 */
export type RuntimeTurnDecisionReport = Omit<
  TurnDecisionReport,
  keyof NullableReportArrays | "coverage" | "source"
> &
  NullableReportArrays & {
    coverage?: RuntimeCoverage | null;
    source?: readonly RuntimeSourceGroup[] | null;
  };

function arrayOrEmpty<T>(value: readonly T[] | null | undefined): T[] {
  return Array.isArray(value) ? [...value] : [];
}

function normalizeCoverage(
  coverage: RuntimeCoverage | null | undefined,
): TurnDecisionCoverage {
  return {
    covered: typeof coverage?.covered === "number" ? coverage.covered : 0,
    total: typeof coverage?.total === "number" ? coverage.total : 0,
    areas: arrayOrEmpty(coverage?.areas),
  };
}

function normalizeSourceGroups(
  groups: readonly RuntimeSourceGroup[] | null | undefined,
): TurnSourceGroup[] {
  return arrayOrEmpty(groups).map((group) => ({
    ...group,
    items: arrayOrEmpty(group.items),
  }));
}

/**
 * Return a render-safe report, or `undefined` when no report exists.
 *
 * The result conforms to the public `TurnDecisionReport` contract: collection
 * fields are arrays, coverage always has an `areas` array, and `null` chips
 * remain absent so derived chips can take over.
 */
export function normalizeTurnDecisionReport(
  report: RuntimeTurnDecisionReport | null | undefined,
): TurnDecisionReport | undefined {
  if (!report) return undefined;

  const normalized: TurnDecisionReport = {
    schemaVersion: 1,
    reportId: report.reportId,
    runId: report.runId,
    ...(report.traceId ? { traceId: report.traceId } : {}),
    turn: report.turn,
    saw: arrayOrEmpty(report.saw),
    considered: arrayOrEmpty(report.considered),
    freshness: arrayOrEmpty(report.freshness),
    cache: arrayOrEmpty(report.cache),
    decisions: arrayOrEmpty(report.decisions),
    source: normalizeSourceGroups(report.source),
    coverage: normalizeCoverage(report.coverage),
    gaps: arrayOrEmpty(report.gaps),
  };

  if (Array.isArray(report.chips)) {
    normalized.chips = [...report.chips];
  }

  return normalized;
}
