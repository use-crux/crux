/** Core-owned Node discovery/coordinator contract shared with Crux Local. */

import type { AnyEval } from "../evaluate";
import { getEvalDefinitionForInternalUse } from "../internal/definition";
import { materializeEvalForInternalUse } from "../internal/runner";
import type { EvalPlan, EvalRun } from "../internal/types";
import {
  discoverProjectEvals,
  selectEvals,
  type DiscoveredEval,
} from "./discovery";
import { hydrateEvalCases, type HydratedEval } from "./cases";
import {
  coordinateNodeEval,
  type NodeEvalCoordinatorOptions,
} from "./coordinator";

export {
  collectEvalModules,
  deriveEvalId,
  discoverProjectEvals,
  selectEvals,
  siblingCaseFile,
} from "./discovery";
export { hydrateEvalCases, loadCaseRows } from "./cases";
export { discoverDeployableProjectEvals } from "./deployed-discovery";
export { EvalCaseFileError, resolveAuthoredCaseFile } from "./case-path";
export {
  coordinateNodeEval,
  createNodeEvalCoordinatorSession,
} from "./coordinator";
export { compareEvalDefinitionToBaseline } from "../internal/baseline";
export { addReviewCase } from "./review";
export type { AddReviewCaseInput, AddReviewCaseResult } from "./review";
export {
  fingerprintDeployedEvalCase,
  projectDeployedEvalRequiredHostCapabilities,
  projectDeployedEvalVariants,
} from "../../runtime/eval-registry/projection";
export {
  fingerprintEvalPersistencePolicy,
  normalizeEvalPersistencePolicy,
} from "../internal/redact";
export type { EvalPersistencePolicy } from "../internal/redact";
export {
  createEvalBaselineFileStore,
  createEvalEvidenceFileStore,
  createEvalRunFileStore,
  EvalBaselineFileError,
  setEvalBaseline,
} from "./stores";
export type {
  DiscoveredEval,
  EvalDiscoveryError,
  EvalDiscoveryResult,
  EvalModule,
} from "./discovery";
export type { HydratedEval, LoadedEvalCase } from "./cases";

/** Worker/Core compatibility marker for the Node discovery protocol. */
export const EVAL_NODE_RUNNER_PROTOCOL = 1 as const;

export interface NodeRunEvalOptions extends NodeEvalCoordinatorOptions {
  readonly case?: string | readonly string[];
}

/** Run a prevalidated public input through authoritative Node discovery. */
export async function runDiscoveredEval(
  evalOrId: AnyEval | string,
  options: NodeRunEvalOptions,
  projectRoot: string,
): Promise<EvalPlan | EvalRun> {
  const discovery = await discoverProjectEvals(projectRoot);
  if (discovery.errors.length > 0) {
    throw new TypeError(
      discovery.errors.map((entry) => entry.message).join("\n"),
    );
  }
  const selector =
    typeof evalOrId === "string"
      ? evalOrId
      : getEvalDefinitionForInternalUse(evalOrId).explicitId!;
  const selected = selectEvals(discovery.evals, [selector]);
  if (selected.errors.length > 0) {
    throw new TypeError(selected.errors.join("\n"));
  }
  if (selected.matches.length !== 1) {
    throw new TypeError(
      `runEval('${selector}') matched ${selected.matches.length} Evals. Use one exact Eval id or source path.`,
    );
  }
  const discovered = selected.matches[0]!;
  if (typeof evalOrId !== "string" && !Object.is(evalOrId, discovered.eval)) {
    throw new TypeError(identityError(selector, discovered));
  }
  const hydrated = selectCases(
    await hydrateEvalCases(discovered, { projectRoot }),
    normalizeCaseSelectors(options.case),
  );
  const coordinated = await coordinateNodeEval(
    hydrated,
    {
      ...(options.variant !== undefined ? { variant: options.variant } : {}),
      ...(options.fresh ? { fresh: true } : {}),
      ...(options.offline ? { offline: true } : {}),
      ...(options.plan ? { plan: true } : {}),
      ...(options.maxCostUsd !== undefined
        ? { maxCostUsd: options.maxCostUsd }
        : {}),
      ...(hydrated.filteredSelection ? { filtered: true } : {}),
      ...(options.confirmUnknownCost ? { confirmUnknownCost: true } : {}),
    },
    projectRoot,
  );
  if (options.plan) {
    if (coordinated.plan.hostReadiness.status === "mismatch") {
      throw new TypeError(
        `${coordinated.plan.hostReadiness.reason} ${coordinated.plan.hostReadiness.remedy}`,
      );
    }
    return coordinated.plan;
  }
  assertExecutable(coordinated.plan, selector);
  return coordinated.execute();
}

/** Apply CLI-compatible `only` and Case wildcard selection. */
export function selectHydratedCases(
  entry: HydratedEval,
  patterns: readonly string[],
): HydratedEval {
  return selectCases(entry, patterns);
}

function selectCases(
  entry: HydratedEval,
  patterns: readonly string[],
): HydratedEval {
  const only = entry.cases.filter((item) => item.authored.only === true);
  const candidates = only.length > 0 ? only : entry.cases;
  const selected =
    patterns.length === 0
      ? candidates
      : candidates.filter((item) =>
          patterns.some((pattern) => {
            const matcher = wildcardPattern(pattern);
            return (
              matcher.test(item.id) ||
              (item.authored.name !== undefined &&
                matcher.test(item.authored.name))
            );
          }),
        );
  if (selected.length === 0) {
    throw new TypeError(
      `Eval '${entry.id}' has no Case matching ${patterns.map((value) => `'${value}'`).join(", ")}.`,
    );
  }
  const cases = selected.map((item) => {
    const { only: _only, ...authored } = item.authored;
    return Object.freeze({ ...item, authored: Object.freeze(authored) });
  });
  return Object.freeze({
    ...entry,
    ...(only.length > 0 || patterns.length > 0
      ? { filteredSelection: true as const }
      : {}),
    cases: Object.freeze(cases),
    eval: materializeEvalForInternalUse(entry.eval, {
      id: entry.id,
      cases: cases.map((item) => item.authored),
    }),
  });
}

function assertExecutable(plan: EvalPlan, selector: string): void {
  if (plan.preflight.status === "blocked") {
    throw new TypeError(
      `Offline run needs ${plan.preflight.misses.length} uncached external result(s); no external calls were made. Remove offline or run '${selector}' online.`,
    );
  }
  if (plan.hostReadiness.status === "unverified") {
    throw new TypeError(
      `Eval '${selector}' requires an unverified deployed Runtime. ${plan.hostReadiness.remedies.join(" ")}`,
    );
  }
  if (plan.hostReadiness.status === "mismatch") {
    throw new TypeError(
      `${plan.hostReadiness.reason} ${plan.hostReadiness.remedy}`,
    );
  }
  if (plan.cost.admission.status !== "admitted") {
    const unknown = plan.cost.actions
      .map((action) => action.estimate)
      .filter((estimate) => estimate.kind === "unknown");
    const missingKeys = [
      ...new Set(unknown.flatMap((estimate) => estimate.missingPricingKeys)),
    ].sort();
    const remedies = [...new Set(unknown.map((estimate) => estimate.remedy))];
    throw new TypeError(
      `Eval '${selector}' was not admitted before spend (${plan.cost.admission.reason}).${missingKeys.length > 0 ? ` Missing pricing keys: ${missingKeys.join(", ")}.` : ""} ${remedies.join(" ")} Use plan:true to inspect actions.`,
    );
  }
}

function identityError(id: string, discovered: DiscoveredEval): string {
  return `runEval() received an Eval object for '${id}' that is not the exact default export discovered in '${discovered.sourceKey.relativeFile}'. Import and pass that exact default export, or use runEval('${id}') for stale HMR/watch references, separately called evaluate(), or alias/symlink loader identities.`;
}

function normalizeCaseSelectors(
  value: string | readonly string[] | undefined,
): readonly string[] {
  return value === undefined ? [] : typeof value === "string" ? [value] : value;
}

function wildcardPattern(value: string): RegExp {
  const escaped = value
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`);
}
