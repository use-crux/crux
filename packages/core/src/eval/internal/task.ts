/**
 * Private provider-neutral execution protocol for managed Eval tasks.
 *
 * The global symbol lets compatible copies of Core exchange task descriptors
 * without making the protocol part of the public Eval authoring surface.
 *
 * @internal
 * @module
 */

import type { StreamCompletion } from "../../adapter/result-accumulator";
export type { EvalCostEstimate, EvalCostEstimationRequest } from "./cost-types";
import type { CallOf, EvalTaskLike, InputOf, OutputOf } from "../task";
import {
  isCompatibleEvalTaskDescriptor,
  normalizeEvalTaskIdentityProjection,
} from "./task-protocol-values";
import { fingerprintEvalValue } from "./identity";
import { evalTaskExecutionContextForInternalUse } from "./task-execution-context";
import {
  EVAL_TASK_IDENTITY_EPOCH,
  EVAL_TASK_INTERNAL,
  EvalTaskExecutionError,
  type EvalTaskDescriptor,
  type EvalTaskDiagnostics,
  type EvalTaskExecutionResult,
  type EvalTaskIdentityProjection,
  type EvalTaskIdentityProjectionRequest,
} from "./task-descriptor";

export {
  applyEvalTaskExecutionContext,
  resolveTaskTimeoutOverrideForInternalUse,
  type EvalTaskExecutionContext,
} from "./task-execution-context";
export {
  EVAL_TASK_IDENTITY_EPOCH,
  EVAL_TASK_INTERNAL,
  EvalTaskExecutionError,
  type EvalRequiredHostCapability,
  type EvalTaskDescriptor,
  type EvalTaskDiagnostics,
  type EvalTaskExecutionErrorCode,
  type EvalTaskExecutionResult,
  type EvalTaskIdentityProjection,
  type EvalTaskIdentityProjectionRequest,
  type EvalTaskScorerContextRequest,
} from "./task-descriptor";

/** Attach and freeze a Core-owned descriptor before freezing its callable. */
export function attachEvalTaskDescriptorForInternalUse<
  TTask extends (...args: never[]) => unknown,
  TResult,
  TOutput,
>(task: TTask, descriptor: EvalTaskDescriptor<TResult, TOutput>): TTask {
  const normalized = Object.freeze({
    ...descriptor,
    capabilities: Object.freeze([...descriptor.capabilities]),
    ...(descriptor.requiredHostCapabilities !== undefined
      ? {
          requiredHostCapabilities: Object.freeze([
            ...descriptor.requiredHostCapabilities,
          ]),
        }
      : {}),
    defaults: Object.isFrozen(descriptor.defaults)
      ? descriptor.defaults
      : Object.freeze({ ...descriptor.defaults }),
    overrideKeys: Object.freeze([...descriptor.overrideKeys]),
  });
  Object.defineProperty(task, EVAL_TASK_INTERNAL, {
    value: normalized,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(task);
}

/** Read and structurally validate a managed task descriptor. */
export function getEvalTaskDescriptorForInternalUse(
  task: unknown,
): EvalTaskDescriptor {
  if (typeof task !== "function" || !(EVAL_TASK_INTERNAL in task)) {
    throw missingDescriptor();
  }

  const descriptor = (task as Record<PropertyKey, unknown>)[EVAL_TASK_INTERNAL];
  if (!isCompatibleEvalTaskDescriptor(descriptor)) {
    throw new EvalTaskExecutionError(
      "descriptor_incompatible",
      "Managed Eval task descriptor is incompatible. This usually means @use-crux/core and @use-crux/ai are on mixed fixed versions; align both packages to the same compatible release.",
    );
  }
  return descriptor;
}

/** Distinguish opaque callables from compatible managed tasks. */
export function isManagedEvalTaskForInternalUse(task: unknown): boolean {
  try {
    getEvalTaskDescriptorForInternalUse(task);
    return true;
  } catch (error) {
    if (
      error instanceof EvalTaskExecutionError &&
      error.code === "descriptor_missing"
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * Fingerprint the explicit managed-task contract and authored task source.
 *
 * Adapter-projected prompt/model/settings semantics are deliberately composed
 * separately by the portable planner. Function source rendering is never an
 * identity input because it is unstable across bundlers and JavaScript hosts.
 */
export function fingerprintManagedEvalTaskForInternalUse(
  task: unknown,
  taskSourceFingerprint: string,
): string {
  const descriptor = getEvalTaskDescriptorForInternalUse(task);
  return fingerprintEvalValue({
    taskIdentityEpoch: EVAL_TASK_IDENTITY_EPOCH,
    taskSourceFingerprint,
    adapterId: descriptor.adapterId,
    operation: descriptor.operation,
    outputContract: descriptor.outputContractFingerprint ?? null,
    callContract: descriptor.callContractFingerprint ?? null,
    capabilities: [...descriptor.capabilities].sort(),
  });
}

/** Execute one Case through the provider-neutral managed task protocol. */
export async function executeEvalTaskForInternalUse<TTask extends EvalTaskLike>(
  task: TTask,
  input: InputOf<TTask>,
  callOptions?: CallOf<TTask>,
  overrides: Readonly<object> = {},
): Promise<EvalTaskExecutionResult<OutputOf<TTask>>> {
  const descriptor = getEvalTaskDescriptorForInternalUse(task);
  const productionResult = await descriptor.execute(
    input,
    callOptions,
    overrides,
    evalTaskExecutionContextForInternalUse(),
  );
  const output = descriptor.projectOutput(productionResult);
  if (output === undefined) {
    throw structuredOutputMissing(descriptor);
  }
  const renderedPromptIdentity =
    descriptor.readRenderedPromptIdentity?.(productionResult);
  return Object.freeze({
    output: output as OutputOf<TTask>,
    response: descriptor.projectResponse(productionResult) as StreamCompletion<
      OutputOf<TTask>
    >,
    observedIdentity: normalizeEvalTaskIdentityProjection(
      descriptor.projectIdentity({
        phase: "observed",
        input,
        ...(callOptions !== undefined ? { call: callOptions } : {}),
        overrides,
        result: productionResult,
      }),
    ),
    ...(renderedPromptIdentity !== undefined
      ? {
          renderedPromptIdentity: normalizeEvalTaskIdentityProjection(
            renderedPromptIdentity,
          ),
        }
      : {}),
  });
}

/** Project and normalize the adapter-semantic identity used by planning. */
export function projectEvalTaskIdentityForInternalUse(
  task: unknown,
  request: EvalTaskIdentityProjectionRequest<unknown>,
): EvalTaskIdentityProjection {
  const descriptor = getEvalTaskDescriptorForInternalUse(task);
  return normalizeEvalTaskIdentityProjection(
    descriptor.projectIdentity(request),
  );
}

function missingDescriptor(): EvalTaskExecutionError {
  return new EvalTaskExecutionError(
    "descriptor_missing",
    "Eval execution requires a managed task created with generate.task() or stream.task().",
  );
}

function structuredOutputMissing(
  descriptor: EvalTaskDiagnostics,
): EvalTaskExecutionError {
  const prompt = descriptor.promptId
    ? ` for prompt \"${descriptor.promptId}\"`
    : "";
  return new EvalTaskExecutionError(
    "structured_output_missing",
    `Managed ${descriptor.operation} task${prompt} returned no structured output; the adapter must return a validated object or throw its validation failure.`,
    descriptor,
  );
}
