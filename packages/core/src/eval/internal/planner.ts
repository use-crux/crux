/** Pure ordered Case × Variant × trial planning for portable Eval. @internal */

import type { AnyEval } from "../evaluate";
import { resolveEvalArms } from "./arm-policy";
import { resolveInlineCases } from "./case-matrix";
import { getEvalDefinitionForInternalUse } from "./definition";
import { readTaskEvidenceEntry } from "./evidence";
import { resolveEvalCellFreshness, type EvalCellFreshness } from "./freshness";
import {
  createTaskEvidenceIdentity,
  fingerprintEvalValue,
  isReusableEvalValue,
} from "./identity";
import type { EvalPlanningPorts } from "./ports";
import { createEvalPreflight } from "./offline";
import { createEvalCostPlan } from "./cost-plan";
import { planExternalScorers } from "./scorer-plan";
import {
  EvalTaskExecutionError,
  projectEvalTaskIdentityForInternalUse,
} from "./task";
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
    for (const arm of arms) {
      for (let trial = 0; trial < resolvedCase.trials; trial++) {
        const cell = await planCell({
          evalId,
          resolvedCase,
          arm,
          trial,
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
  readonly scorers: unknown;
  readonly freshness: EvalCellFreshness;
  readonly ports?: EvalPlanningPorts;
}): Promise<EvalPlannedCell> {
  const authored = input.resolvedCase.authored;
  const request = {
    evalId: input.evalId,
    caseId: input.resolvedCase.caseId,
    variant: input.arm.name,
    trial: input.trial,
    task: input.arm.task,
    overrides: input.arm.overrides,
    input: authored.input as Readonly<Record<string, unknown>>,
    ...(authored.call !== undefined
      ? { call: authored.call as Readonly<Record<string, unknown>> }
      : {}),
  };
  const action = authored.skip
    ? Object.freeze({
        kind: "skip" as const,
        reason: "source_skipped" as const,
        ...(typeof authored.skip === "string" ? { detail: authored.skip } : {}),
      })
    : await planTaskAction(request, input.ports, input.freshness);
  const cellBase = {
    caseId: input.resolvedCase.caseId,
    ...(authored.name !== undefined ? { caseName: authored.name } : {}),
    variant: input.arm.name,
    trial: input.trial,
    blocking: input.arm.blocking,
    task: input.arm.task,
    overrides: input.arm.overrides,
    action,
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
  const scorerActions = action.kind === "skip" ? Object.freeze([]) : await planExternalScorers({
    rawScorers: input.scorers,
    cell: Object.freeze({ ...cellBase, scorerActions: Object.freeze([]) }),
    taskAction: action,
    actionPrefix: `${request.caseId}:${request.variant}:${request.trial}`,
    ...(input.freshness.reason === "fresh_requested"
      ? { bypassEvidenceReason: input.freshness.reason }
      : {}),
    ...(input.ports !== undefined
      ? {
          evidenceStore: input.ports.evidenceStore,
          ...(input.ports.externalScorerHostContractFingerprint !== undefined
            ? {
                hostContractFingerprint:
                  input.ports.externalScorerHostContractFingerprint,
              }
            : {}),
        }
      : {}),
  });
  return Object.freeze({ ...cellBase, scorerActions });
}

async function planTaskAction(
  request: Parameters<EvalPlanningPorts["taskIdentity"]["describe"]>[0],
  ports: EvalPlanningPorts | undefined,
  freshness: EvalCellFreshness,
) {
  if (ports === undefined) {
    return Object.freeze({
      kind: "execute" as const,
      reason: "live_required" as const,
    });
  }
  const description = await ports.taskIdentity.describe(request);
  if (!description.reusable) {
    return Object.freeze({
      kind: "execute" as const,
      reason: description.reason,
    });
  }
  if (
    !isReusableEvalValue(request.input) ||
    !isReusableEvalValue(request.call)
  ) {
    return Object.freeze({
      kind: "execute" as const,
      reason: "implicit_media" as const,
    });
  }
  let projection;
  try {
    projection = projectEvalTaskIdentityForInternalUse(request.task, {
      phase: "plan",
      input: request.input,
      ...(request.call !== undefined ? { call: request.call } : {}),
      overrides: request.overrides,
    });
  } catch (error) {
    if (
      error instanceof EvalTaskExecutionError &&
      error.code === "descriptor_missing"
    ) {
      return Object.freeze({
        kind: "execute" as const,
        reason: "identity_unavailable" as const,
      });
    }
    throw error;
  }
  if (!projection.reusable) {
    return Object.freeze({
      kind: "execute" as const,
      reason: projection.reason,
    });
  }
  const adapterFingerprint = fingerprintEvalValue(
    projection.fingerprintMaterial,
  );
  const identity = createTaskEvidenceIdentity({
    evalId: request.evalId,
    caseId: request.caseId,
    input: request.input,
    ...(request.call !== undefined ? { call: request.call } : {}),
    variant: request.variant,
    trial: request.trial,
    managedTaskFingerprint: description.managedTaskFingerprint,
    adapterFingerprint,
    hostContractFingerprint: description.hostContractFingerprint,
    occurrence: "root",
  });
  if (freshness.reason !== undefined) {
    return Object.freeze({
      kind: "execute" as const,
      reason: freshness.reason,
      evidenceKey: identity.key,
      plannedAdapterFingerprint: adapterFingerprint,
      ...(freshness.source !== undefined
        ? { freshnessSource: freshness.source }
        : {}),
    });
  }
  const evidence = readTaskEvidenceEntry(
    await ports.evidenceStore.read(identity.key),
    identity.key,
  );
  return evidence === undefined
    ? Object.freeze({
        kind: "execute" as const,
        reason: "no_exact_evidence" as const,
        evidenceKey: identity.key,
        plannedAdapterFingerprint: adapterFingerprint,
      })
    : Object.freeze({
        kind: "reuse" as const,
        reason: "exact_evidence" as const,
        evidence,
      });
}

function assertSupportedDefinition(
  definition: ReturnType<typeof getEvalDefinitionForInternalUse>,
): void {
  if (definition.explicitId === undefined) {
    throw new TypeError("Phase 8 Eval execution requires an explicit Eval id.");
  }
  if (definition.caseFiles.length > 0) {
    throw new TypeError("Phase 8 does not yet support caseFile() sources.");
  }
  if (definition.cases.some((authored) => authored.only !== undefined)) {
    throw new TypeError("Eval planning does not yet support Case `only` flags.");
  }
}
