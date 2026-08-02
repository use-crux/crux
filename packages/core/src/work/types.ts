/** Public, target-derived contracts for finite durable Work. */

import type { EffectScopeRef } from "../effect";
import type { FlowHandle } from "../flow/handle-types";
import type { FlowSignalMap } from "../flow/signals";
import type { ScopeStats } from "../statistics/types";

declare const workIdTarget: unique symbol;

/** Any named Flow definition that can be exported as a durable Work target. */
export type ExportedFlowTarget = FlowHandle<
  unknown,
  unknown,
  FlowSignalMap | undefined,
  string
>;

/** Extract the exact input accepted by an exported Flow target. */
export type WorkInput<TTarget extends ExportedFlowTarget> =
  TTarget extends FlowHandle<
    unknown,
    infer TInput,
    FlowSignalMap | undefined,
    string
  >
    ? TInput
    : never;

/** Extract the exact successful result returned by an exported Flow target. */
export type WorkResult<TTarget extends ExportedFlowTarget> =
  TTarget extends FlowHandle<
    infer TResult,
    unknown,
    FlowSignalMap | undefined,
    string
  >
    ? TResult
    : never;

/** Extract the stable literal identity of an exported Flow target. */
export type WorkTargetId<TTarget extends ExportedFlowTarget> = TTarget["name"];

/**
 * Stable Work identity qualified by its exported Flow target.
 *
 * @remarks The target brand prevents an ID returned for one named Flow from
 * being used to reconnect a different Flow, while remaining a string on the
 * wire.
 */
export type WorkId<TTarget extends ExportedFlowTarget> = string & {
  readonly [workIdTarget]: WorkTargetId<TTarget>;
};

/** Latest bounded progress snapshot published by a Work occurrence. */
export interface WorkProgress {
  /** Human-readable safe progress summary. */
  readonly message?: string;
  /** Completed units when progress is countable. */
  readonly current?: number;
  /** Total units when known. */
  readonly total?: number;
}

interface WorkStatusBase<TId extends string, TTargetId extends string> {
  readonly id: TId;
  readonly targetId: TTargetId;
  readonly acceptedAt: Date;
  readonly updatedAt: Date;
  readonly progress?: WorkProgress;
}

/** Shared readonly lifecycle shape used by durable and process-local Work. @internal */
export type WorkStatusSnapshot<
  TId extends string,
  TTargetId extends string,
  TResult,
> =
  | (WorkStatusBase<TId, TTargetId> & { readonly state: "queued" })
  | (WorkStatusBase<TId, TTargetId> & {
      readonly state: "running";
      readonly startedAt: Date;
    })
  | (WorkStatusBase<TId, TTargetId> & {
      readonly state: "suspended";
      readonly startedAt: Date;
      readonly suspendedAt: Date;
      readonly suspendedOn?: string;
    })
  | (WorkStatusBase<TId, TTargetId> & {
      readonly state: "blocked";
      readonly startedAt?: Date;
      readonly blockedAt: Date;
      readonly blockedOn?: string;
    })
  | (WorkStatusBase<TId, TTargetId> & {
      readonly state: "completed";
      readonly startedAt: Date;
      readonly completedAt: Date;
      readonly result: TResult;
    })
  | (WorkStatusBase<TId, TTargetId> & {
      readonly state: "failed";
      readonly startedAt?: Date;
      readonly failedAt: Date;
      readonly error: unknown;
    })
  | (WorkStatusBase<TId, TTargetId> & {
      readonly state: "cancelled";
      readonly startedAt?: Date;
      readonly cancelledAt: Date;
      readonly reason?: string;
    });

/** Readonly lifecycle snapshot for one target-qualified Work occurrence. */
export type WorkStatus<TTarget extends ExportedFlowTarget> = WorkStatusSnapshot<
  WorkId<TTarget>,
  WorkTargetId<TTarget>,
  WorkResult<TTarget>
>;

/** Ordered, cursor-resumable event yielded by {@link WorkHandle.stream}. */
export type WorkEvent<TTarget extends ExportedFlowTarget> =
  | { readonly type: "snapshot"; readonly status: WorkStatus<TTarget> }
  | { readonly type: "progress"; readonly progress: WorkProgress }
  | {
      readonly type: "completed";
      readonly result: WorkResult<TTarget>;
    }
  | { readonly type: "failed"; readonly error: unknown }
  | { readonly type: "cancelled"; readonly reason?: string };

/** Options for cooperatively requesting Work cancellation. */
export interface CancelOptions {
  /** Safe cancellation reason retained with the occurrence when supported. */
  readonly reason?: string;
}

/** Result of an idempotent cooperative cancellation request. */
export interface CancelReceipt {
  /** Whether this call accepted a new cancellation request. */
  readonly cancelled: boolean;
}

/** Result of releasing the caller's attachment to Work. */
export interface DetachReceipt {
  /** Whether this call released a live local attachment. */
  readonly detached: boolean;
}

/** Cursor options for reconnecting to an ordered Work event stream. */
export interface WorkStreamOptions {
  /** Resume after an implementation-owned opaque event cursor. */
  readonly cursor?: string;
}

/** Canonical bounded execution statistics for one Work scope. */
export type ExecutionStats = ScopeStats;

/**
 * Readonly public view over one durable, target-qualified Work occurrence.
 *
 * @typeParam TTarget - Exported Flow whose input and result define this Work.
 */
export interface WorkHandle<TTarget extends ExportedFlowTarget> {
  /** Stable identity qualified by {@link targetId}. */
  readonly id: WorkId<TTarget>;
  /** Stable exported Flow identity pinned at acceptance. */
  readonly targetId: WorkTargetId<TTarget>;
  /** Stable Effect scope owned by this Work occurrence. */
  readonly effects: EffectScopeRef;
  /** Read the latest immutable lifecycle snapshot. */
  status(): Promise<WorkStatus<TTarget>>;
  /** Wait for and return the exact successful Flow result. */
  result(): Promise<WorkResult<TTarget>>;
  /** Publish the latest bounded progress snapshot without waking an owner. */
  progress(update: WorkProgress): Promise<void>;
  /** Cooperatively request durable cancellation. */
  cancel(options?: CancelOptions): Promise<CancelReceipt>;
  /** Release only this caller's attachment; never cancel the Work. */
  detach(): Promise<DetachReceipt>;
  /** Read ordered lifecycle and progress events from an optional cursor. */
  stream(options?: WorkStreamOptions): AsyncIterable<WorkEvent<TTarget>>;
  /** Read bounded canonical execution statistics. */
  stats(): Promise<ExecutionStats>;
}

/** Required caller-owned identity for top-level Work acceptance. */
export interface SpawnWorkOptions {
  /** Key scoped by Runtime namespace and stable exported target identity. */
  readonly idempotencyKey: string;
}
