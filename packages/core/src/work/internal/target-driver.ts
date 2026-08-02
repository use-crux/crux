/**
 * Internal execution boundary between Work and first-party targets.
 *
 * @internal
 * @module
 */

import type { EffectScopeRef } from "../../effect/types";

/** Context owned by one process-local Work execution. @internal */
export interface InternalWorkExecutionContext {
  /** Stable identity of the accepted Work occurrence. */
  readonly id: string;
  /** Identity of the direct attached parent, when this Work is attached. */
  readonly attachedParentId?: string;
  /** Child-owned cooperative cancellation linked to its attached parent. */
  readonly signal: AbortSignal;
  /** Passive Effect boundary containing the target execution. */
  readonly effects: EffectScopeRef;
}

/** Bound first-party target execution consumed by the Work kernel. @internal */
export interface InternalWorkTargetDriver<TOutput> {
  /** Execute the bound target once and return its exact business output. */
  run(context: InternalWorkExecutionContext): Promise<TOutput>;
}
