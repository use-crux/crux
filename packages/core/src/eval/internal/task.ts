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
import type { StandardSchemaV1 } from "../../quality/standard-schema";
import type {
  CallOf,
  EvalCapability,
  EvalTaskLike,
  InputOf,
  OutputOf,
} from "../task";

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
  /** Input-independent adapter options bound to the task. */
  readonly defaults: Readonly<object>;
  /** Bound option keys eligible for later override validation. */
  readonly overrideKeys: readonly string[];
  /** Provider-neutral invocation seam captured by the adapter package. */
  readonly execute: (
    input: unknown,
    callOptions?: Readonly<object>,
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
}

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
  if (!isCompatibleDescriptor(descriptor)) {
    throw new EvalTaskExecutionError(
      "descriptor_incompatible",
      "Managed Eval task descriptor is incompatible. This usually means @use-crux/core and @use-crux/ai are on mixed fixed versions; align both packages to the same compatible release.",
    );
  }
  return descriptor;
}

/** Execute one Case through the provider-neutral managed task protocol. */
export async function executeEvalTaskForInternalUse<TTask extends EvalTaskLike>(
  task: TTask,
  input: InputOf<TTask>,
  callOptions?: CallOf<TTask>,
): Promise<EvalTaskExecutionResult<OutputOf<TTask>>> {
  const descriptor = getEvalTaskDescriptorForInternalUse(task);
  const productionResult = await descriptor.execute(input, callOptions);
  const output = descriptor.projectOutput(productionResult);
  if (output === undefined) {
    throw structuredOutputMissing(descriptor);
  }
  return Object.freeze({
    output: output as OutputOf<TTask>,
    response: descriptor.projectResponse(productionResult) as StreamCompletion<
      OutputOf<TTask>
    >,
  });
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

function isCompatibleDescriptor(value: unknown): value is EvalTaskDescriptor {
  if (value === null || typeof value !== "object" || !Object.isFrozen(value)) {
    return false;
  }
  const descriptor = value as Record<string, unknown>;
  return (
    descriptor._tag === "CruxEvalTaskDescriptor" &&
    (descriptor.operation === "generate" ||
      descriptor.operation === "stream") &&
    descriptor.adapterId === "ai-sdk" &&
    (descriptor.promptId === undefined ||
      typeof descriptor.promptId === "string") &&
    isOptionalSchema(descriptor.inputSchema) &&
    isOptionalSchema(descriptor.outputSchema) &&
    Array.isArray(descriptor.capabilities) &&
    Object.isFrozen(descriptor.capabilities) &&
    descriptor.capabilities.every(isEvalCapability) &&
    isRecord(descriptor.defaults) &&
    Object.isFrozen(descriptor.defaults) &&
    Array.isArray(descriptor.overrideKeys) &&
    Object.isFrozen(descriptor.overrideKeys) &&
    descriptor.overrideKeys.every((key) => typeof key === "string") &&
    typeof descriptor.execute === "function" &&
    typeof descriptor.projectOutput === "function" &&
    typeof descriptor.projectResponse === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOptionalSchema(value: unknown): boolean {
  if (value === undefined) return true;
  if (value === null || typeof value !== "object" || !("~standard" in value)) {
    return false;
  }
  const standard = value["~standard"];
  return (
    standard !== null &&
    typeof standard === "object" &&
    "version" in standard &&
    standard.version === 1 &&
    "vendor" in standard &&
    typeof standard.vendor === "string" &&
    "validate" in standard &&
    typeof standard.validate === "function"
  );
}

function isEvalCapability(value: unknown): value is EvalCapability {
  return (
    typeof value === "string" &&
    [
      "modelCalls",
      "toolCalls",
      "steps",
      "handoffs",
      "retrieval",
      "citations",
      "safety",
      "memory",
      "routing",
      "decisionReport",
    ].includes(value)
  );
}
