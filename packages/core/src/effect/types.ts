/**
 * Public contracts for custom effect definitions and rollback.
 *
 * @module
 */

import type { EffectReceipt } from "./receipt-types";
import type { JsonValue } from "../storage/types";

/** A synchronous value or a promise-like value. */
export type Awaitable<T> = T | PromiseLike<T>;

/** JSON-safe reference to one effect execution receipt. */
export interface EffectReceiptRef {
  /** Reference discriminant. */
  readonly kind: "effect.receipt";
  /** Stable receipt identifier. */
  readonly id: string;
  /** Stable authored effect identifier. */
  readonly effectId: string;
}

/** JSON-safe reference to one effect rollback boundary. */
export interface EffectScopeRef {
  /** Reference discriminant. */
  readonly kind: "effect.scope";
  /** Stable scope identifier. */
  readonly id: string;
  /** Stable run identifier containing the scope. */
  readonly runId: string;
}

/** Stable, non-secret identity for state changed by an effect. */
export interface EffectResource {
  /** Domain resource type. */
  readonly type: string;
  /** Optional resource identifier. */
  readonly id?: string;
  /** Optional resource namespace. */
  readonly namespace?: string;
  /** Optional safe scalar attributes. */
  readonly attributes?: Readonly<
    Record<string, string | number | boolean>
  >;
}

/** Infrastructure supplied to one effect execution. */
export interface EffectExecutionContext {
  /** Stable execution idempotency key for this occurrence. */
  readonly idempotencyKey: string;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
  /** Receipt identifier allocated before execution. */
  readonly receiptId: string;
  /** Owning rollback scope. */
  readonly scope: EffectScopeRef;
}

/** Output and receipt returned by the advanced execution path. */
export interface EffectExecutionResult<TOutput> {
  /** Executor output. */
  readonly output: TOutput;
  /** Reference to the immutable receipt. */
  readonly receipt: EffectReceiptRef;
}

/** Context supplied to a custom recovery handler. */
export interface EffectRecoveryContext<TInput, TOutput> {
  /** Original effect input. */
  readonly input: TInput;
  /** Settled effect output. */
  readonly output: TOutput;
  /** Original effect receipt. */
  readonly receipt: EffectReceiptRef;
  /** Projected resource identity. */
  readonly resource?: EffectResource | readonly EffectResource[];
  /** Stable recovery idempotency key, distinct from the execution key. */
  readonly idempotencyKey: string;
  /** Conflict policy requested by the caller. */
  readonly conflict: "fail" | "force";
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
}

/** Context supplied before an effect captures recovery state. */
export interface EffectCaptureContext<TInput> {
  /** Original effect input. */
  readonly input: TInput;
  /** Receipt allocated for the pending execution. */
  readonly receipt: EffectReceiptRef;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
}

/** Recovery context including captured pre-state. */
export interface CapturedEffectRecoveryContext<
  TInput,
  TOutput,
  TCaptured,
> extends EffectRecoveryContext<TInput, TOutput> {
  /** Pre-state captured before execution. */
  readonly captured: TCaptured;
}

/** Base options for an effect definition. */
export interface EffectOptions<TInput> {
  /** Recovery/output replay contract version. Defaults to `1`. */
  readonly version?: number;
  /** Project the smallest stable resource identity before execution. */
  readonly resource?: (
    input: TInput,
  ) => EffectResource | readonly EffectResource[] | undefined;
}

/** Options for recovery derived from an effect's input and output. */
export interface RecoverableEffectOptions<TInput, TOutput>
  extends EffectOptions<TInput> {
  /** Recover one successful effect occurrence. */
  readonly recover: (
    context: EffectRecoveryContext<TInput, TOutput>,
  ) => Awaitable<void>;
}

/** Options for recovery that requires captured pre-state. */
export interface CapturedRecoverableEffectOptions<
  TInput,
  TOutput,
  TCaptured,
> extends EffectOptions<TInput> {
  /** Capture pre-state and execute recovery. */
  readonly recover: {
    /** Capture state before the effect executor runs. */
    readonly capture: (
      context: EffectCaptureContext<TInput>,
    ) => Awaitable<TCaptured>;
    /** Recover using the captured state. */
    readonly execute: (
      context: CapturedEffectRecoveryContext<
        TInput,
        TOutput,
        TCaptured
      >,
    ) => Awaitable<void>;
  };
}

/** Callable arguments inferred from an effect's input type. */
export type EffectCallArgs<TInput> = [TInput] extends [void]
  ? [] | [input: TInput]
  : [input: TInput];

/** Function that performs one custom effect occurrence. */
export type EffectExecutor<TInput, TOutput> = (
  input: TInput,
  context: EffectExecutionContext,
) => Awaitable<TOutput>;

/** Options shared by scope and individual recovery. */
export interface RollbackOptions {
  /** Human-readable recovery reason. */
  readonly reason?: string;
  /** Conflict behavior. Defaults to `"fail"`. */
  readonly conflict?: "fail" | "force";
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
}

/** Options for recovering one receipt. */
export interface RecoverOptions extends RollbackOptions {}

/** Settlement status for one recovery unit. */
export type RecoveryUnitStatus =
  | "recovered"
  | "already_recovered"
  | "unavailable"
  | "irreversible"
  | "expired"
  | "conflict"
  | "handler_unavailable"
  | "ambiguous"
  | "failed"
  | "cancelled";

/** Result of attempting one recovery unit. */
export interface RecoveryUnitResult {
  /** Stable recovery-unit identifier. */
  readonly unitId: string;
  /** Effect definitions covered by the unit. */
  readonly effectIds: readonly string[];
  /** Safe resource identity associated with the unit. */
  readonly resource?: EffectResource | readonly EffectResource[];
  /** Recovery settlement. */
  readonly status: RecoveryUnitStatus;
  /** Structured failure summary, when present. */
  readonly error?: {
    /** Stable diagnostic code. */
    readonly code: string;
    /** Safe failure message. */
    readonly message: string;
  };
}

/** Aggregate result of rolling back one scope. */
export interface RollbackResult {
  /** Scope that was rolled back. */
  readonly scope: EffectScopeRef;
  /** Aggregate rollback settlement. */
  readonly status:
    | "completed"
    | "partial"
    | "not_possible"
    | "failed"
    | "cancelled";
  /** Per-unit settlements. */
  readonly units: readonly RecoveryUnitResult[];
  /** Rollback start time in epoch milliseconds. */
  readonly startedAt: number;
  /** Rollback completion time in epoch milliseconds. */
  readonly completedAt: number;
}

/** Typed callable effect definition. */
export interface EffectDefinition<TInput, TOutput> {
  /** Execute the effect and return its ordinary output. */
  (...args: EffectCallArgs<TInput>): Promise<TOutput>;
  /** Stable authored identity. */
  readonly id: string;
  /** Replay and recovery contract version. */
  readonly version: number;
  /** Definition brand. */
  readonly _tag: "EffectDefinition";
  /** Execute the effect and retain its receipt reference. */
  run(
    ...args: EffectCallArgs<TInput>
  ): Promise<EffectExecutionResult<TOutput>>;
}

/** Effect definition with individual recovery. */
export interface RecoverableEffectDefinition<TInput, TOutput>
  extends EffectDefinition<TInput, TOutput> {
  /** Recover one receipt created by this definition. */
  recover(
    receipt: EffectReceiptRef,
    options?: RecoverOptions,
  ): Promise<RecoveryUnitResult>;
}

/** Authorized resolution for an ambiguous effect outcome. */
export type EffectReconciliation<
  TOutput extends JsonValue = JsonValue,
> =
  | {
      /** Confirm the effect succeeded. */
      readonly outcome: "succeeded";
      /** Confirmed executor output. */
      readonly output: TOutput;
      /** Audit reason for the resolution. */
      readonly reason: string;
    }
  | {
      /** Confirm the effect failed. */
      readonly outcome: "failed";
      /** Audit reason for the resolution. */
      readonly reason: string;
    };

/** Controller supplied inside a rollback boundary. */
export interface RollbackBoundaryController {
  /** Boundary reference. */
  readonly ref: EffectScopeRef;
  /** Roll back completed recovery units in the boundary. */
  rollback(options?: RollbackOptions): Promise<RollbackResult>;
}

/** Recovery guarantee for a rollback boundary. */
export interface RollbackOnErrorOptions {
  /** Whether every encountered effect must be recoverable. */
  readonly recovery?: "required" | "best-effort";
}

/** Reconcile an ambiguous receipt into a settled receipt. */
export type ReconcileEffect = (
  receipt: EffectReceiptRef,
  resolution: EffectReconciliation,
) => Promise<EffectReceipt>;
