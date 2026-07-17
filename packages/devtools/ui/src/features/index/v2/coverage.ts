/**
 * Catalog runtime-coverage classification.
 *
 * Consumes the compiler-owned `DEFINITION_KIND_COVERAGE` manifest
 * (`@use-crux/core/project-index`) plus the per-definition activity rollup
 * (`GET /api/observability/definitions/{id}/activity`) to decide which of
 * the five Catalog Observability treatments a definition gets. This is
 * deliberately not a hand-rolled switch over `ProjectDefinitionKind` — every
 * branch below reads `primary`/`secondary`/`runtimePrimitiveNames` off the
 * manifest, so a newly-added kind is classified correctly the moment its
 * manifest entry lands, with no Catalog-side kind list to keep in sync.
 */

import {
  DEFINITION_KIND_COVERAGE,
  type CoverageDescriptor,
} from "@use-crux/core/project-index";
import type { ObservabilityDefinitionActivitySummary } from "@/types";

const FALLBACK_COVERAGE: CoverageDescriptor = { primary: "fallback" };

/** Look up a kind's coverage descriptor, tolerating kinds absent from the manifest (never expected, but never a crash). */
export function coverageForKind(kind: string): CoverageDescriptor {
  return (
    (
      DEFINITION_KIND_COVERAGE as Record<string, CoverageDescriptor | undefined>
    )[kind] ?? FALLBACK_COVERAGE
  );
}

export type CatalogCoverageTreatment =
  | "direct-activity"
  | "contributor"
  | "runtime-unjoined"
  | "quality-primary"
  | "no-runtime";

/** The Catalog Observability section's read model for one definition. */
export interface CatalogCoverageState {
  treatment: CatalogCoverageTreatment;
  coverage: CoverageDescriptor;
  /** Distinct runs that referenced this definition, per the activity rollup. */
  runCount: number;
  hasRuntimeEvidence: boolean;
  /** Activity comes from the indexed parent, not an independently observed child. */
  parentDerived: boolean;
}

/**
 * Classify one definition for the Catalog Observability section.
 *
 * - `direct-activity` — the kind is `directly-observed`: it's the subject of
 *   its own runtime span. Shows the span-correlation card + "View N runs".
 * - `contributor` — `runtime-contributor` or `structural-child` with a live
 *   identity path (`definition-ref` or `parent-derived`). Canonical refs may
 *   show "referenced by N runs"; parent-derived children report the parent's
 *   activity as not independently observed. Never a top-level run subject.
 * - `runtime-unjoined` — the kind emits runtime spans, but those records do
 *   not carry this authored definition's canonical id. Catalog reports the
 *   available primitive family without inventing a definition-level count or
 *   exposing a dead "View Runs" link.
 * - `quality-primary` — `quality-owned` kinds (correlates through the
 *   Quality↔observability join elsewhere on the page). When `secondary`
 *   declares `direct-runtime` (e.g. `scorer`), the activity rollup still
 *   surfaces genuine secondary runtime evidence (e.g. live `scoring.judge`
 *   spans) instead of silently dropping it.
 * - `no-runtime` — `static-only`, the `fallback` sentinel, or
 *   `runtimeIdentity: 'none'` (injectables, storage ports, unsupported
 *   structural children): truthful zero runtime — never a fabricated count,
 *   arbitrary owner, or dead "View runs" link.
 */
export function describeCatalogCoverage(
  kind: string,
  activity: ObservabilityDefinitionActivitySummary | undefined,
  parentActivity?: ObservabilityDefinitionActivitySummary,
): CatalogCoverageState {
  const coverage = coverageForKind(kind);
  const parentDerived = coverage.runtimeIdentity === "parent-derived";
  const runCount = (parentDerived ? parentActivity : activity)?.runCount ?? 0;
  const declaresDirectRuntime =
    coverage.primary === "directly-observed" ||
    Boolean(coverage.secondary?.includes("direct-runtime"));

  if (
    coverage.primary === "quality-owned" ||
    coverage.secondary?.includes("quality-owned")
  ) {
    return {
      treatment: "quality-primary",
      coverage,
      runCount: declaresDirectRuntime ? runCount : 0,
      hasRuntimeEvidence: declaresDirectRuntime && runCount > 0,
      parentDerived: false,
    };
  }

  if (coverage.primary === "directly-observed") {
    return {
      treatment: "direct-activity",
      coverage,
      runCount,
      hasRuntimeEvidence: runCount > 0,
      parentDerived: false,
    };
  }

  if (coverage.primary === "runtime-observed-unjoined") {
    return {
      treatment: "runtime-unjoined",
      coverage,
      runCount: 0,
      hasRuntimeEvidence: false,
      parentDerived: false,
    };
  }

  if (coverage.runtimeIdentity === "none") {
    return {
      treatment: "no-runtime",
      coverage,
      runCount: 0,
      hasRuntimeEvidence: false,
      parentDerived: false,
    };
  }

  const isDerivedContributor =
    coverage.primary === "runtime-contributor" ||
    coverage.primary === "structural-child";

  if (isDerivedContributor) {
    return {
      treatment: "contributor",
      coverage,
      runCount,
      hasRuntimeEvidence: runCount > 0,
      parentDerived,
    };
  }

  return {
    treatment: "no-runtime",
    coverage,
    runCount: 0,
    hasRuntimeEvidence: false,
    parentDerived: false,
  };
}
