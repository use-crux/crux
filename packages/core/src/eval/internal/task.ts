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
import type { StandardSchemaV1 } from "./schema";
import type { JsonValue } from "../../storage/types";
import type {
  CallOf,
  EvalCapability,
  EvalTaskLike,
  InputOf,
  OutputOf,
} from "../task";
import {
  isCompatibleEvalTaskDescriptor,
  normalizeEvalTaskIdentityProjection,
} from "./task-protocol-values";

/** Global storage key shared by compatible Core module copies. */
export const EVAL_TASK_INTERNAL: unique symbol = Symbol.for(
  "@use-crux/core/eval/task-descriptor",
) as never;

/** Stable failure categories for the managed Eval task protocol. */
export type EvalTaskExecutionErrorCode =
  | "descriptor_missing"
  | "descriptor_incompatible"
  | "structured_output_missing";

/** Diagnostic identity attached to managed task execution failures. */
export interface EvalTaskDiagnostics {
  readonly operation: "generate" | "stream";
  readonly adapterId: "ai-sdk";
  readonly promptId?: string;
}

/** Adapter-owned, provider-neutral semantic identity projection. */
export type EvalTaskIdentityProjection =
  | {
      readonly reusable: true;
      readonly fingerprintMaterial: JsonValue;
    }
  | {
      readonly reusable: false;
      readonly reason:
        | "identity_unavailable"
        | "untracked_external_dependency"
        | "implicit_media";
    };

/** Inputs available before execution and after observing its terminal result. */
export type EvalTaskIdentityProjectionRequest<TResult> =
  | {
      readonly phase: "plan";
      readonly input: unknown;
      readonly call?: Readonly<object>;
      readonly overrides: Readonly<object>;
    }
  | {
      readonly phase: "observed";
      readonly input: unknown;
      readonly call?: Readonly<object>;
      readonly overrides: Readonly<object>;
      readonly result: TResult;
    };

/**
 * Private execution descriptor attached to a production-callable Eval task.
 *
 * The protocol is intentionally unversioned: structural validation rejects a
 * descriptor from an incompatible package pair before its closure can run.
 */
export interface EvalTaskDescriptor<
  TResult = unknown,
  TOutput = unknown,
> extends EvalTaskDiagnostics {
  /** Structural discriminator checked before any provider closure is called. */
  readonly _tag: "CruxEvalTaskDescriptor";
  /** Prompt input schema retained by reference for later Case validation. */
  readonly inputSchema?: StandardSchemaV1;
  /** Prompt output schema retained by reference for semantic validation. */
  readonly outputSchema?: StandardSchemaV1;
  /** Trace-signal families captured by this task kind. */
  readonly capabilities: readonly EvalCapability[];
  /** Durable host services required when this task is deployed remotely. */
  readonly requiredHostCapabilities?: readonly EvalRequiredHostCapability[];
  /** Input-independent adapter options bound to the task. */
  readonly defaults: Readonly<object>;
  /** Bound option keys eligible for later override validation. */
  readonly overrideKeys: readonly string[];
  /** Project complete adapter semantics without performing I/O. */
  readonly projectIdentity: (
    request: EvalTaskIdentityProjectionRequest<TResult>,
  ) => EvalTaskIdentityProjection;
  /** Provider-neutral invocation seam captured by the adapter package. */
  readonly execute: (
    input: unknown,
    callOptions?: Readonly<object>,
    overrides?: Readonly<object>,
  ) => Promise<TResult>;
  /** Project the rich production result to the Case's semantic output. */
  readonly projectOutput: (result: TResult) => TOutput | undefined;
  /** Remove provider handles from the terminal production response. */
  readonly projectResponse: (result: TResult) => StreamCompletion<TOutput>;
}

/** Portable value returned by the private Eval executor seam. */
export interface EvalTaskExecutionResult<TOutput> {
  /** Non-optional semantic value assessed by Eval checks and scorers. */
  readonly output: TOutput;
  /** Provider-neutral terminal completion retained as execution evidence. */
  readonly response: StreamCompletion<TOutput>;
  /** Adapter semantics observed from the completed production path. */
  readonly observedIdentity: EvalTaskIdentityProjection;
}

/** Allowlisted durable services a managed task may require from its host. */
export type EvalRequiredHostCapability =
  | "asset-store"
  | "record-store"
  | "vector-store";

/** Coded configuration failure raised by the managed Eval task protocol. */
export class EvalTaskExecutionError extends Error {
  override readonly name = "EvalTaskExecutionError" as const;
  /** Stable protocol failure category. */
  readonly code: EvalTaskExecutionErrorCode;
  /** Managed operation involved when descriptor metadata is available. */
  readonly operation?: "generate" | "stream";
  /** Adapter identity involved when descriptor metadata is available. */
  readonly adapterId?: string;
  /** Prompt identity involved when the managed prompt is named. */
  readonly promptId?: string;

  constructor(
    code: EvalTaskExecutionErrorCode,
    message: string,
    diagnostics: {
      readonly operation?: "generate" | "stream";
      readonly adapterId?: string;
      readonly promptId?: string;
    } = {},
  ) {
    super(message);
    this.code = code;
    this.operation = diagnostics.operation;
    this.adapterId = diagnostics.adapterId;
    this.promptId = diagnostics.promptId;
  }
}

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
  );
  const output = descriptor.projectOutput(productionResult);
  if (output === undefined) {
    throw structuredOutputMissing(descriptor);
  }
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
