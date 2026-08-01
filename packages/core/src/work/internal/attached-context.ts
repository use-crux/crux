/**
 * Ambient identity for attached process-local Work.
 *
 * @internal
 * @module
 */

import { createAsyncScopeFacet } from "../../async-scope";

/** Parent identity and cooperative cancellation inherited by attached Work. @internal */
export interface InternalWorkAttachment {
  /** Identity of the Work occurrence that owns the attached child. */
  readonly parentId: string;
  /** Cooperative cancellation signal owned by the attached parent. */
  readonly signal: AbortSignal;
}

interface AmbientWorkContext {
  readonly id: string;
  readonly signal: AbortSignal;
}

const workContextScope = createAsyncScopeFacet<AmbientWorkContext>(
  "core.process-local-work",
);

/** Return the minimal attachment for the currently executing Work. */
export function currentInternalWorkAttachment():
  | InternalWorkAttachment
  | undefined {
  const current = workContextScope.current();
  return current
    ? Object.freeze({ parentId: current.id, signal: current.signal })
    : undefined;
}

/** Run a target with its attachment context available to nested Work. */
export function runWithInternalWorkContext<T>(
  id: string,
  signal: AbortSignal,
  run: () => T,
): T {
  return workContextScope.run(Object.freeze({ id, signal }), run);
}

/** One child-owned signal linked cooperatively to an optional parent. */
export interface InternalWorkCancellation {
  readonly signal: AbortSignal;
  dispose(): void;
}

/** Create a child-owned signal and release its parent listener after settlement. */
export function createInternalWorkCancellation(
  parentSignal?: AbortSignal,
): InternalWorkCancellation {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  return Object.freeze({
    signal: controller.signal,
    dispose: () => parentSignal?.removeEventListener("abort", abortFromParent),
  });
}
