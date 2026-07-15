/** Pure Current-cell planning for the first portable Eval tracer. @internal */

import type { AnyEval } from "../evaluate";
import { getEvalDefinitionForInternalUse } from "./definition";
import { readTaskEvidenceEntry } from "./evidence";
import {
  createTaskEvidenceIdentity,
  fingerprintEvalValue,
  isReusableEvalValue,
} from "./identity";
import type { EvalPlanningPorts } from "./ports";
import { planExternalScorers } from "./scorer-plan";
import {
  EvalTaskExecutionError,
  projectEvalTaskIdentityForInternalUse,
} from "./task";
import type { EvalPlan, EvalSourceKey } from "./types";

export async function planEval(
  evalValue: AnyEval,
  options: { readonly sourceKey: EvalSourceKey },
  ports?: EvalPlanningPorts,
): Promise<EvalPlan> {
  const definition = getEvalDefinitionForInternalUse(evalValue);
  assertPhase5Definition(definition);
  const evalId = definition.explicitId!;
  const authoredCase = definition.cases[0]!;
  const caseId = authoredCase.id!;
  const sourceKey = Object.freeze({ ...options.sourceKey });
  const request = {
    evalId,
    caseId,
    variant: "current" as const,
    trial: 0 as const,
    task: definition.task,
    input: authoredCase.input as Readonly<Record<string, unknown>>,
    ...(authoredCase.call !== undefined
      ? { call: authoredCase.call as Readonly<Record<string, unknown>> }
      : {}),
  };
  const action = await planTaskAction(request, ports);
  const cell = Object.freeze({
    caseId,
    ...(authoredCase.name !== undefined ? { caseName: authoredCase.name } : {}),
    variant: "current" as const,
    trial: 0 as const,
    action,
    input: authoredCase.input as Readonly<Record<string, unknown>>,
    ...(authoredCase.call !== undefined
      ? { call: authoredCase.call as Readonly<Record<string, unknown>> }
      : {}),
    ...(authoredCase.expected !== undefined
      ? { expected: authoredCase.expected }
      : {}),
    ...(authoredCase.expect !== undefined
      ? { expect: authoredCase.expect }
      : {}),
  });
  const selection = Object.freeze({
    cases: Object.freeze([caseId]),
    variants: Object.freeze(["current"] as const),
    trials: 1 as const,
  });
  const scorerActions = await planExternalScorers({
    rawScorers: definition.scorers,
    cell,
    taskAction: action,
    ...(ports !== undefined
      ? {
          evidenceStore: ports.evidenceStore,
          ...(ports.externalScorerHostContractFingerprint !== undefined
            ? {
                hostContractFingerprint:
                  ports.externalScorerHostContractFingerprint,
              }
            : {}),
        }
      : {}),
  });
  return Object.freeze({
    schemaVersion: 1 as const,
    evalId,
    sourceKey,
    definitionFingerprint: `phase5:${evalId}`,
    selection,
    task: definition.task,
    ...(definition.expect !== undefined ? { expect: definition.expect } : {}),
    scorers: definition.scorers,
    scorerActions,
    cells: Object.freeze([cell] as const),
  });
}

async function planTaskAction(
  request: Parameters<EvalPlanningPorts["taskIdentity"]["describe"]>[0],
  ports: EvalPlanningPorts | undefined,
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
      overrides: EMPTY_OVERRIDES,
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

const EMPTY_OVERRIDES = Object.freeze({});

function assertPhase5Definition(
  definition: ReturnType<typeof getEvalDefinitionForInternalUse>,
): void {
  if (definition.explicitId === undefined) {
    throw new TypeError("Phase 5 Eval execution requires an explicit Eval id.");
  }
  if (definition.caseFiles.length > 0) {
    throw new TypeError("Phase 5 does not yet support caseFile() sources.");
  }
  if (definition.cases.length !== 1 || definition.cases[0]?.id === undefined) {
    throw new TypeError(
      "Phase 5 requires exactly one inline Case with an explicit id.",
    );
  }
  if (definition.arms.length !== 1) {
    throw new TypeError(
      "Phase 5 executes Current only; Variants arrive in Phase 8.",
    );
  }
  if (definition.trials !== 1 || definition.cases[0].trials !== undefined) {
    throw new TypeError("Phase 5 supports exactly one trial.");
  }
  if (definition.gates !== undefined || definition.afterScores !== undefined) {
    throw new TypeError(
      "Phase 5 does not execute Gates or afterScores checks.",
    );
  }
  if (
    definition.cases[0].skip !== undefined ||
    definition.cases[0].only !== undefined
  ) {
    throw new TypeError("Phase 5 does not support Case selection flags.");
  }
}
