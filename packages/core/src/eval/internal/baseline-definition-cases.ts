/** Pure Case-contract guards for inert Baseline compatibility. @internal */

import type {
  EvalBaselineDefinitionCompatibility,
  EvalBaselineV3,
} from "./baseline-types";
import { getEvalDefinitionForInternalUse } from "./definition";
import { fingerprintEvalValue, isReusableEvalValue } from "./identity";

type EvalDefinition = ReturnType<typeof getEvalDefinitionForInternalUse>;

/**
 * Validate structural Case invariants and detect unprojectable implicit IDs.
 *
 * Malformed trials and duplicate projectable identities remain definition
 * errors instead of being mislabeled as unknown compatibility.
 */
export function hasUnprojectableImplicitCase(
  definition: EvalDefinition,
): boolean {
  assertTrials(definition.trials, "Eval");
  return definition.cases.reduce<{
    readonly identities: readonly {
      readonly caseId: string;
      readonly index: number;
    }[];
    readonly unprojectable: boolean;
  }>(
    (state, authored, index) => {
      assertTrials(
        authored.trials ?? definition.trials,
        authored.id === undefined
          ? `Inline Case ${index + 1}`
          : `Case '${authored.id}'`,
      );
      if (authored.id === undefined && !isReusableEvalValue(authored.input)) {
        return { ...state, unprojectable: true };
      }
      const caseId = authored.id ?? fingerprintEvalValue(authored.input);
      const previous = state.identities.find(
        (entry) => entry.caseId === caseId,
      );
      if (previous !== undefined) {
        throw new TypeError(
          `planEval(): duplicate Case id '${caseId}' at inline Cases ${previous.index + 1} and ${index + 1}.`,
        );
      }
      return {
        ...state,
        identities: [...state.identities, { caseId, index }],
      };
    },
    { identities: [], unprojectable: false },
  ).unprojectable;
}

/** Build the conservative result for an unprojectable implicit Case set. */
export function unprojectableCaseCompatibility(
  definition: EvalDefinition,
  currentDefinitionFingerprint: string,
  baseline: EvalBaselineV3,
  variantFound: boolean,
): EvalBaselineDefinitionCompatibility {
  const baselineIDs = new Set(baseline.coverage.map((entry) => entry.caseId));
  const currentOnlyCases = Object.freeze(
    definition.cases
      .filter(
        (authored) =>
          !authored.skip &&
          authored.id !== undefined &&
          !baselineIDs.has(authored.id),
      )
      .map((authored) => authored.id!),
  );
  const status =
    !variantFound || currentOnlyCases.length > 0
      ? ("incompatible" as const)
      : ("unknown" as const);
  return Object.freeze({
    status,
    reason: !variantFound
      ? "selected_variant_missing"
      : currentOnlyCases.length > 0
        ? "case_coverage_changed"
        : "case_contract_unprojectable",
    currentDefinitionFingerprint,
    baselineDefinitionFingerprint: baseline.provenance.definitionFingerprint,
    variant: Object.freeze({
      name: baseline.selectedArm,
      status: variantFound ? ("compatible" as const) : ("missing" as const),
      ...(!variantFound ? { reason: "selected_variant_missing" } : {}),
    }),
    cases: Object.freeze(
      baseline.coverage.map((reference) =>
        Object.freeze({
          caseId: reference.caseId,
          status: "unknown" as const,
          reason: "case_contract_unprojectable",
          metrics: Object.freeze([]),
        }),
      ),
    ),
    currentOnlyCases,
  });
}

function assertTrials(value: number, source: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${source} trials must be a positive integer.`);
  }
}
