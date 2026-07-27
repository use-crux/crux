/** Provider-neutral value contracts for the managed Eval task protocol. */

import type { StreamCompletion } from "../../adapter/result-accumulator";
import type { JsonValue } from "../../storage/types";
import type { EvalCapability } from "../task";
import type { GenerateFn } from "./capabilities";
import type { EvalCostEstimate, EvalCostEstimationRequest } from "./cost-types";
import type { ScorerRunContext } from "./scorers/runtime";
import type { StandardSchemaV1 } from "./schema";
import type { EvalTaskExecutionContext } from "./task-execution-context";

/** Global storage key shared by compatible Core module copies. */
export const EVAL_TASK_INTERNAL: unique symbol = Symbol.for(
  "@use-crux/core/eval/task-descriptor",
) as never;

/**
 * Persisted identity epoch for the adapter task protocol.
 *
 * Bump this when descriptor execution/projection semantics change without an
 * authored definition or adapter identity-projection change.
 */
export const EVAL_TASK_IDENTITY_EPOCH = 2;

export type EvalTaskExecutionErrorCode =
  | "descriptor_missing"
  | "descriptor_incompatible"
  | "structured_output_missing";

export interface EvalTaskDiagnostics {
  readonly operation: "generate" | "stream";
  readonly adapterId: "ai-sdk";
  readonly promptId?: string;
}

export type EvalTaskIdentityProjection =
  | {
      readonly reusable: true;
      readonly fingerprintMaterial: JsonValue;
    }
  | {
      readonly reusable: false;
      readonly reason:
        | "identity_unavailable"
        | "model_identity_unattested"
        | "untracked_external_dependency"
        | "unresolved_source_dependency"
        | "implicit_media";
    };

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

export interface EvalTaskScorerContextRequest {
  readonly input: unknown;
  readonly call?: Readonly<object>;
  readonly overrides: Readonly<object>;
  readonly model?: unknown;
  readonly generate?: GenerateFn;
  readonly authoredSourceFingerprint?: string;
}

/** Private execution descriptor attached to a production-callable Eval task. */
export interface EvalTaskDescriptor<
  TResult = unknown,
  TOutput = unknown,
> extends EvalTaskDiagnostics {
  readonly _tag: "CruxEvalTaskDescriptor";
  /** Exact execution/projection contract understood by this descriptor. */
  readonly identityEpoch: typeof EVAL_TASK_IDENTITY_EPOCH;
  readonly inputSchema?: StandardSchemaV1;
  readonly outputSchema?: StandardSchemaV1;
  readonly outputContractFingerprint?: string;
  readonly callContractFingerprint?: string;
  readonly capabilities: readonly EvalCapability[];
  readonly requiredHostCapabilities?: readonly EvalRequiredHostCapability[];
  readonly defaults: Readonly<object>;
  readonly overrideKeys: readonly string[];
  readonly validateVariantOverrides?: (
    overrides: Readonly<Record<string, unknown>>,
  ) => void;
  readonly validateVariantInput?: (
    input: unknown,
    overrides: Readonly<Record<string, unknown>>,
  ) => void | Promise<void>;
  readonly validateVariantCall?: (
    call: Readonly<Record<string, unknown>> | undefined,
    overrides: Readonly<Record<string, unknown>>,
  ) => void;
  readonly projectIdentity: (
    request: EvalTaskIdentityProjectionRequest<TResult>,
  ) => EvalTaskIdentityProjection;
  readonly projectRenderedPromptIdentity?: (
    request: Extract<
      EvalTaskIdentityProjectionRequest<TResult>,
      { readonly phase: "plan" }
    >,
  ) => Promise<EvalTaskIdentityProjection>;
  readonly readRenderedPromptIdentity?: (
    result: TResult,
  ) => EvalTaskIdentityProjection;
  readonly projectScorerContext?: (
    request: EvalTaskScorerContextRequest,
  ) => EvalTaskIdentityProjection;
  readonly createScorerContext?: (
    request: EvalTaskScorerContextRequest,
  ) => ScorerRunContext;
  readonly estimateCost?: (
    request: EvalCostEstimationRequest,
  ) => EvalCostEstimate;
  readonly execute: (
    input: unknown,
    callOptions: Readonly<object> | undefined,
    overrides: Readonly<object>,
    context: EvalTaskExecutionContext,
  ) => Promise<TResult>;
  readonly projectOutput: (result: TResult) => TOutput | undefined;
  readonly projectResponse: (result: TResult) => StreamCompletion<TOutput>;
}

export interface EvalTaskExecutionResult<TOutput> {
  readonly output: TOutput;
  readonly response: StreamCompletion<TOutput>;
  readonly observedIdentity: EvalTaskIdentityProjection;
  readonly renderedPromptIdentity?: EvalTaskIdentityProjection;
}

export type EvalRequiredHostCapability =
  | "asset-store"
  | "record-store"
  | "vector-store";

/** Coded configuration failure raised by the managed Eval task protocol. */
export class EvalTaskExecutionError extends Error {
  override readonly name = "EvalTaskExecutionError" as const;
  readonly code: EvalTaskExecutionErrorCode;
  readonly operation?: "generate" | "stream";
  readonly adapterId?: string;
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
