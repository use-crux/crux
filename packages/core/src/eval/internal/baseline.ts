/** Pure construction and granular comparison for Eval Baseline V3. @internal */

import { fingerprintEvalValue } from "./identity";
import type {
  EvalBaselineComparison,
  EvalBaselineDefinitionCompatibility,
  EvalBaselineV3,
} from "./baseline-types";
import type { AnyEval } from "../evaluate";
import { getEvalDefinitionForInternalUse } from "./definition";
import { resolveInlineCases } from "./case-matrix";
import { isReusableEvalValue } from "./identity";
import {
  contractStatus,
  projectDefinitionScorerContracts,
} from "./baseline-definition-scorers";
import {
  hasUnprojectableImplicitCase,
  unprojectableCaseCompatibility,
} from "./baseline-definition-cases";

export type { EvalBaselineComparison, EvalBaselineV3 } from "./baseline-types";

/**
 * Compare a committed Baseline with one already-discovered inert definition.
 * This is contract-only: it never invokes checks/scorers, resolves a host, or
 * reads execution evidence. Dynamic scorer factories remain explicitly unknown.
 */
export function compareEvalDefinitionToBaseline(
  evalValue: AnyEval,
  currentDefinitionFingerprint: string,
  baseline: EvalBaselineV3,
): EvalBaselineDefinitionCompatibility {
  const definition = getEvalDefinitionForInternalUse(evalValue);
  if (definition.explicitId !== baseline.evalId) {
    return Object.freeze({
      status: "incompatible" as const,
      reason: "eval_identity_changed",
      currentDefinitionFingerprint,
      baselineDefinitionFingerprint: baseline.provenance.definitionFingerprint,
      variant: Object.freeze({
        name: baseline.selectedArm,
        status: "missing" as const,
        reason: "eval_identity_changed",
      }),
      cases: Object.freeze([]),
      currentOnlyCases: Object.freeze([]),
    });
  }
  const variantFound = definition.arms.some(
    (arm) => arm.name === baseline.selectedArm,
  );
  if (hasUnprojectableImplicitCase(definition)) {
    return unprojectableCaseCompatibility(
      definition,
      currentDefinitionFingerprint,
      baseline,
      variantFound,
    );
  }
  const currentCases = resolveInlineCases(definition);
  const currentByID = new Map(
    currentCases.map((entry) => [entry.caseId, entry]),
  );
  const baselineIDs = new Set(baseline.coverage.map((entry) => entry.caseId));
  const scorerContracts = projectDefinitionScorerContracts(definition.scorers);
  const cases = baseline.coverage.map((reference) => {
    const current = currentByID.get(reference.caseId);
    if (current === undefined) {
      return Object.freeze({
        caseId: reference.caseId,
        status: "missing" as const,
        reason: "current_case_missing",
        metrics: Object.freeze([]),
      });
    }
    const authored = current.authored;
    if (!isProjectableCaseContract(authored)) {
      return Object.freeze({
        caseId: reference.caseId,
        status: "unknown" as const,
        reason: "case_contract_unprojectable",
        metrics: Object.freeze([]),
      });
    }
    const identityMatches =
      reference.inputFingerprint === fingerprintEvalValue(authored.input) &&
      reference.callFingerprint ===
        fingerprintEvalValue(authored.call ?? null) &&
      reference.expectedFingerprint ===
        fingerprintEvalValue(authored.expected ?? null) &&
      reference.trials.join(",") ===
        Array.from({ length: current.trials }, (_, trial) => trial).join(",");
    if (!identityMatches) {
      return Object.freeze({
        caseId: reference.caseId,
        status: "incompatible" as const,
        reason: "case_contract_changed",
        metrics: Object.freeze([]),
      });
    }
    const metrics = Object.entries(reference.metrics).map(([name, metric]) => {
      if (scorerContracts.status === "unknown") {
        return Object.freeze({
          name,
          status: "unknown" as const,
          reason: "scorer_contract_unprojectable",
        });
      }
      const currentContract = scorerContracts.contracts.get(name);
      if (currentContract === undefined) {
        return Object.freeze({
          name,
          status: "missing" as const,
          reason: "scorer_missing",
        });
      }
      if (currentContract === "unknown") {
        return Object.freeze({
          name,
          status: "unknown" as const,
          reason: "scorer_contract_unprojectable",
        });
      }
      return currentContract === metric.contractFingerprint
        ? Object.freeze({ name, status: "compatible" as const })
        : Object.freeze({
            name,
            status: "incompatible" as const,
            reason: "metric_contract_changed",
          });
    });
    const status = contractStatus(metrics.map((metric) => metric.status));
    return Object.freeze({
      caseId: reference.caseId,
      status,
      ...(status === "unknown"
        ? { reason: "scorer_contract_unprojectable" }
        : status === "missing"
          ? { reason: "metric_missing" }
          : status === "incompatible"
            ? { reason: "metric_contract_changed" }
            : {}),
      metrics: Object.freeze(metrics),
    });
  });
  const currentOnlyCases = Object.freeze(
    currentCases
      .filter((entry) => !entry.authored.skip && !baselineIDs.has(entry.caseId))
      .map((entry) => entry.caseId),
  );
  const hasIncompatible =
    !variantFound ||
    currentOnlyCases.length > 0 ||
    cases.some(
      (entry) => entry.status === "missing" || entry.status === "incompatible",
    );
  const hasUnknown = cases.some((entry) => entry.status === "unknown");
  const status = hasIncompatible
    ? ("incompatible" as const)
    : hasUnknown
      ? ("unknown" as const)
      : ("compatible" as const);
  const unknownReason = cases.some(
    (entry) =>
      "reason" in entry &&
      (entry as { readonly reason?: unknown }).reason ===
        "case_contract_unprojectable",
  )
    ? "case_contract_unprojectable"
    : "scorer_contract_unprojectable";
  return Object.freeze({
    status,
    ...(status === "incompatible"
      ? {
          reason: !variantFound
            ? "selected_variant_missing"
            : currentOnlyCases.length > 0
              ? "case_coverage_changed"
              : "baseline_contract_changed",
        }
      : status === "unknown"
        ? { reason: unknownReason }
        : {}),
    currentDefinitionFingerprint,
    baselineDefinitionFingerprint: baseline.provenance.definitionFingerprint,
    variant: Object.freeze({
      name: baseline.selectedArm,
      status: variantFound ? ("compatible" as const) : ("missing" as const),
      ...(!variantFound ? { reason: "selected_variant_missing" } : {}),
    }),
    cases: Object.freeze(cases),
    currentOnlyCases,
  });
}

function isProjectableCaseContract(authored: {
  readonly input: unknown;
  readonly call?: unknown;
  readonly expected?: unknown;
}): boolean {
  return (
    isReusableEvalValue(authored.input) &&
    isReusableEvalValue(authored.call ?? null) &&
    isReusableEvalValue(authored.expected ?? null)
  );
}

export {
  buildEvalBaseline,
  type BuildEvalBaselineOptions,
} from "./baseline-promotion";
export {
  compareEvalCellsToBaseline,
  compareEvalRunToBaseline,
} from "./baseline-run-comparison";
