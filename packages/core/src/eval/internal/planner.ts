/** Pure ordered Case × Variant × trial planning for portable Eval. @internal */

import type { AnyEval } from "../evaluate";
import {
  resolveEvalTimeoutPolicy,
  type ResolvedEvalTimeoutPolicy,
} from "../timeout-policy";
import { resolveEvalArms } from "./arm-policy";
import { resolveInlineCases } from "./case-matrix";
import { getEvalDefinitionForInternalUse } from "./definition";
import { resolveEvalCellFreshness, type EvalCellFreshness } from "./freshness";
import type { EvalPlanningPorts } from "./ports";
import { createEvalPreflight } from "./offline";
import { createEvalCostPlan } from "./cost-plan";
import {
  planExternalScorers,
  projectEvalCellScorerContracts,
  resolveEvalScorers,
} from "./scorer-plan";
import { resolveEvalHostReadiness } from "./placement";
import { projectEvalTaskExecution } from "./execution-placement";
import { assertTaskAcceptsCase } from "./task-case-compatibility";
import { EvalTaskExecutionError } from "./task";
import { planEvalTaskAction } from "./task-action-plan";
import type {
  EvalPlan,
  EvalPlannedCell,
  EvalScorerAction,
  EvalSourceKey,
} from "./types";

export async function planEval(
  evalValue: AnyEval,
  options: {
    readonly sourceKey: EvalSourceKey;
    readonly definitionFingerprint?: string;
    readonly variant?: string;
    readonly fresh?: boolean;
    readonly offline?: boolean;
    readonly maxCostUsd?: number;
    readonly interactive?: boolean;
    readonly plan?: boolean;
    readonly filtered?: boolean;
  },
  ports?: EvalPlanningPorts,
): Promise<EvalPlan> {
  const definition = getEvalDefinitionForInternalUse(evalValue);
  assertSupportedDefinition(definition);
  const evalId = definition.explicitId!;
  const resolvedCases = resolveInlineCases(definition);
  const sourceKey = Object.freeze({ ...options.sourceKey });
  const arms = resolveEvalArms(definition, options.variant);
  const cells: EvalPlannedCell[] = [];
  const allScorerActions: EvalScorerAction[] = [];
  for (const resolvedCase of resolvedCases) {
    const timeout = resolveEvalTimeoutPolicy(
      definition.timeout,
      resolvedCase.authored.timeout,
    );
    for (const arm of arms) {
      for (let trial = 0; trial < resolvedCase.trials; trial++) {
        const cell = await planCell({
          evalId,
          resolvedCase,
          arm,
          trial,
          timeout,
          scorers: definition.scorers,
          freshness: resolveEvalCellFreshness(
            definition,
            resolvedCase.authored,
            options.fresh === true,
          ),
          ports,
        });
        cells.push(cell);
        allScorerActions.push(...cell.scorerActions);
      }
    }
  }
  const selection = Object.freeze({
    cases: Object.freeze(resolvedCases.map((entry) => entry.caseId)),
    variants: Object.freeze(arms.map((arm) => arm.name)),
    trials: Math.max(...resolvedCases.map((entry) => entry.trials)),
    caseTrials: Object.freeze(
      Object.fromEntries(
        resolvedCases.map((entry) => [entry.caseId, entry.trials]),
      ),
    ),
    ...(options.filtered === true ? { filtered: true as const } : {}),
  });
  const hostReadiness = await resolveEvalHostReadiness({
    cells,
    offline: options.offline === true,
    ...(ports?.hostReadiness ? { provider: ports.hostReadiness } : {}),
  });
  const cost = await createEvalCostPlan({
    cells,
    rawScorers: definition.scorers,
    options,
    ...(ports?.costEstimator !== undefined
      ? { estimator: ports.costEstimator }
      : {}),
    ...(ports?.costConfirmation !== undefined
      ? { confirmation: ports.costConfirmation }
      : {}),
  });
  return Object.freeze({
    schemaVersion: 1 as const,
    evalId,
    sourceKey,
    definitionFingerprint:
      options.definitionFingerprint ?? `pending-source-identity:${evalId}`,
    selection,
    hostReadiness,
    preflight: createEvalPreflight(
      cells,
      definition.scorers,
      options.offline === true,
    ),
    cost,
    task: definition.task,
    arms,
    ...(definition.expect !== undefined ? { expect: definition.expect } : {}),
    ...(definition.afterScores !== undefined
      ? { afterScores: definition.afterScores }
      : {}),
    scorers: definition.scorers,
    ...(definition.gates !== undefined ? { gates: definition.gates } : {}),
    scorerActions: Object.freeze(allScorerActions),
    cells: Object.freeze(cells),
  });
}

async function planCell(input: {
  readonly evalId: string;
  readonly resolvedCase: ReturnType<typeof resolveInlineCases>[number];
  readonly arm: ReturnType<typeof resolveEvalArms>[number];
  readonly trial: number;
  readonly timeout: ResolvedEvalTimeoutPolicy;
  readonly scorers: unknown;
  readonly freshness: EvalCellFreshness;
  readonly ports?: EvalPlanningPorts;
}): Promise<EvalPlannedCell> {
  const authored = input.resolvedCase.authored;
  const scorers = Object.freeze([...resolveEvalScorers(input.scorers)]);
  const request = {
    evalId: input.evalId,
    caseId: input.resolvedCase.caseId,
    variant: input.arm.name,
    trial: input.trial,
    task: input.arm.task,
    overrides: input.arm.overrides,
    input: authored.input,
    ...(authored.call !== undefined
      ? { call: authored.call as Readonly<Record<string, unknown>> }
      : {}),
  };
  await assertTaskAcceptsCase(
    input.arm.task,
    input.arm.name,
    input.resolvedCase.caseId,
    request.input,
    request.call,
    input.arm.overrides,
  );
  const action = authored.skip
    ? Object.freeze({
        kind: "skip" as const,
        reason: "source_skipped" as const,
        ...(typeof authored.skip === "string" ? { detail: authored.skip } : {}),
      })
    : await planEvalTaskAction(
        request,
        input.timeout,
        input.ports,
        input.freshness,
      );
  const cellBase = {
    caseId: input.resolvedCase.caseId,
    ...(authored.name !== undefined ? { caseName: authored.name } : {}),
    variant: input.arm.name,
    trial: input.trial,
    blocking: input.arm.blocking,
    task: input.arm.task,
    timeout: input.timeout,
    requiredHostCapabilities: requiredHostCapabilities(input.arm.task),
    overrides: input.arm.overrides,
    action,
    scorers,
    scorerContracts: Object.freeze([]),
    input: request.input,
    ...(request.call !== undefined ? { call: request.call } : {}),
    ...(authored.expected !== undefined ? { expected: authored.expected } : {}),
    ...(authored.unvalidatedExpected === true
      ? { unvalidatedExpected: true as const }
      : {}),
    ...(authored.expect !== undefined ? { expect: authored.expect } : {}),
    ...(authored.afterScores !== undefined
      ? { afterScores: authored.afterScores }
      : {}),
  };
  const scorerActions =
    action.kind === "skip"
      ? Object.freeze([])
      : await planExternalScorers({
          rawScorers: scorers,
          cell: Object.freeze({
            ...cellBase,
            scorerActions: Object.freeze([]),
          }),
          taskAction: action,
          actionPrefix: `${request.caseId}:${request.variant}:${request.trial}`,
          ...(input.freshness.reason === "fresh_requested"
            ? { bypassEvidenceReason: input.freshness.reason }
            : {}),
          ...(input.ports !== undefined
            ? {
                evidenceStore: input.ports.evidenceStore,
                ...(input.ports.externalScorerHostContractFingerprint !==
                undefined
                  ? {
                      hostContractFingerprint:
                        input.ports.externalScorerHostContractFingerprint,
                    }
                  : {}),
                ...(input.ports.externalScorerSourceFingerprint !== undefined
                  ? {
                      authoredSourceFingerprint:
                        input.ports.externalScorerSourceFingerprint,
                    }
                  : {}),
              }
            : {}),
        });
  const planned = Object.freeze({ ...cellBase, scorerActions });
  const scorerContracts = projectEvalCellScorerContracts({
    scorers,
    cell: planned,
    ...(input.ports?.externalScorerSourceFingerprint !== undefined
      ? {
          authoredSourceFingerprint:
            input.ports.externalScorerSourceFingerprint,
        }
      : {}),
  });
  return Object.freeze({ ...planned, scorerContracts });
}

function requiredHostCapabilities(task: unknown): readonly string[] {
  const projection = projectEvalTaskExecution(task);
  if (projection.status === "invalid") {
    throw new EvalTaskExecutionError(
      "descriptor_incompatible",
      projection.reason,
    );
  }
  return projection.requiredHostCapabilities;
}

function assertSupportedDefinition(
  definition: ReturnType<typeof getEvalDefinitionForInternalUse>,
): void {
  if (definition.explicitId === undefined) {
    throw new TypeError(
      "Eval execution requires an explicit id. Add `id` to evaluate({...}) or run through the project coordinator so Crux can derive it from the file path.",
    );
  }
  if (definition.caseFiles.length > 0) {
    throw new TypeError(
      "planEval() received unresolved caseFile() sources. Run through `crux eval` or hydrate file-backed Cases before planning.",
    );
  }
  if (definition.cases.some((authored) => authored.only !== undefined)) {
    throw new TypeError(
      "planEval() received unresolved Case `only` flags. Run through the Eval coordinator so Crux can apply Case selection before planning.",
    );
  }
}
