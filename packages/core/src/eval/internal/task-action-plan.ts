/** Exact evidence lookup and live-execution planning for one Eval task. @internal */

import {
  projectResolvedEvalTimeoutPolicy,
  type ResolvedEvalTimeoutPolicy,
} from "../timeout-policy";
import { readTaskEvidenceEntry } from "./evidence";
import type { EvalCellFreshness } from "./freshness";
import {
  createTaskEvidenceIdentity,
  fingerprintEvalValue,
  isReusableEvalValue,
} from "./identity";
import type { EvalPlanningPorts } from "./ports";
import {
  EvalTaskExecutionError,
  getEvalTaskDescriptorForInternalUse,
  projectEvalTaskIdentityForInternalUse,
} from "./task";
import type { EvalPlanAction } from "./types";

type TaskIdentityRequest = Parameters<
  EvalPlanningPorts["taskIdentity"]["describe"]
>[0];

/** Resolve exact reuse or live execution without mutating task or policy data. */
export async function planEvalTaskAction(
  request: TaskIdentityRequest,
  timeout: ResolvedEvalTimeoutPolicy,
  ports: EvalPlanningPorts | undefined,
  freshness: EvalCellFreshness,
): Promise<EvalPlanAction> {
  if (ports === undefined) {
    return planLiveExecution("live_required", freshness);
  }
  const description = await ports.taskIdentity.describe(request);
  if (!description.reusable) {
    return planLiveExecution(description.reason, freshness);
  }
  if (
    !isReusableEvalValue(request.input) ||
    (request.call !== undefined && !isReusableEvalValue(request.call))
  ) {
    return planLiveExecution("implicit_media", freshness);
  }
  const projected = projectTaskIdentity(request);
  if (projected.status === "unavailable") {
    return planLiveExecution("identity_unavailable", freshness);
  }
  const projection = projected.value;
  if (!projection.reusable) {
    return planLiveExecution(projection.reason, freshness);
  }
  const descriptor = getEvalTaskDescriptorForInternalUse(request.task);
  if (
    containsManagedRenderer(projection.fingerprintMaterial) &&
    (descriptor.projectRenderedPromptIdentity === undefined ||
      descriptor.readRenderedPromptIdentity === undefined)
  ) {
    return planLiveExecution("untracked_external_dependency", freshness);
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
    timeout: projectResolvedEvalTimeoutPolicy(timeout),
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
  if (evidence === undefined) {
    return Object.freeze({
      kind: "execute" as const,
      reason: "no_exact_evidence" as const,
      evidenceKey: identity.key,
      plannedAdapterFingerprint: adapterFingerprint,
    });
  }
  if (descriptor.projectRenderedPromptIdentity !== undefined) {
    const rendered = await descriptor.projectRenderedPromptIdentity({
      phase: "plan",
      input: request.input,
      ...(request.call !== undefined ? { call: request.call } : {}),
      overrides: request.overrides,
    });
    if (!rendered.reusable) {
      return planLiveExecution(rendered.reason, freshness);
    }
    if (
      evidence.result.renderedPromptFingerprint !==
      fingerprintEvalValue(rendered.fingerprintMaterial)
    ) {
      return Object.freeze({
        kind: "execute" as const,
        reason: "nondeterministic_renderer" as const,
        evidenceKey: identity.key,
        plannedAdapterFingerprint: adapterFingerprint,
      });
    }
  }
  return Object.freeze({
    kind: "reuse" as const,
    reason: "exact_evidence" as const,
    evidence,
  });
}

function projectTaskIdentity(request: TaskIdentityRequest) {
  try {
    return Object.freeze({
      status: "ready" as const,
      value: projectEvalTaskIdentityForInternalUse(request.task, {
        phase: "plan",
        input: request.input,
        ...(request.call !== undefined ? { call: request.call } : {}),
        overrides: request.overrides,
      }),
    });
  } catch (error) {
    if (
      error instanceof EvalTaskExecutionError &&
      error.code === "descriptor_missing"
    ) {
      return Object.freeze({ status: "unavailable" as const });
    }
    throw error;
  }
}

function containsManagedRenderer(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsManagedRenderer);
  if (value === null || typeof value !== "object") return false;
  const record = value as Readonly<Record<string, unknown>>;
  return (
    record.kind === "managed_renderer" ||
    Object.values(record).some(containsManagedRenderer)
  );
}

function planLiveExecution(
  fallback: Extract<EvalPlanAction, { readonly kind: "execute" }>["reason"],
  freshness: EvalCellFreshness,
): EvalPlanAction {
  return Object.freeze({
    kind: "execute" as const,
    reason: freshness.reason ?? fallback,
    ...(freshness.source !== undefined
      ? { freshnessSource: freshness.source }
      : {}),
  });
}
