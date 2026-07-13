import { createDeferError } from "./errors";
import { asyncScopeActive } from "../async-scope/internal/carrier";
import { currentDeferRegistration } from "./internal/context";
import { deferReplayActive } from "./internal/replay-guard";
import {
  isRuntimeTaskTarget,
  type RuntimeTaskInput,
  type RuntimeTaskTarget,
} from "../runtime/api/task";
import type { DeferredWorkRef } from "./types";

export { CruxDeferError, DEFER_ERROR_CODES } from "./errors";
export type { CruxDeferErrorCode, DeferErrorInput } from "./errors";
export type { Awaitable, DeferredCallback, DeferredWorkRef } from "./types";
import type { DeferredCallback } from "./types";

type IsUnion<T, TWhole = T> = T extends TWhole
  ? [TWhole] extends [T]
    ? false
    : true
  : never;

type NonUnion<T> = true extends IsUnion<T> ? never : T;

/**
 * Register work to start after the active host completion boundary.
 *
 * The callback overload is lazy and returns `void`. The named overload awaits
 * durable staging and returns a work reference; execution still waits until
 * the invocation commits its logical outcome.
 */
export function defer<TTarget extends RuntimeTaskTarget>(
  target: TTarget & NonUnion<TTarget>,
  input: RuntimeTaskInput<TTarget>,
): Promise<DeferredWorkRef>;
export function defer(callback: DeferredCallback): void;
export function defer(
  callbackOrTarget: DeferredCallback | RuntimeTaskTarget,
  input?: unknown,
): void | Promise<DeferredWorkRef> {
  if (deferReplayActive()) {
    throw createDeferError({
      code: "DEFER_REPLAY_UNSAFE",
      message:
        "defer() cannot run inside replayable flow execution. Use flow.defer() for durable work with stable replay identity.",
    });
  }
  const registration = currentDeferRegistration();
  if (isRuntimeTaskTarget(callbackOrTarget)) {
    if (registration) {
      return registration.scope.stageNamed(callbackOrTarget, input);
    }
    throwMissingScope();
  }
  if (registration) {
    registration.scope.registerInline(callbackOrTarget, registration);
    return;
  }
  throwMissingScope();
}

function throwMissingScope(): never {
  if (asyncScopeActive()) {
    throw createDeferError({
      code: "DEFER_CAPABILITY_MISSING",
      message:
        "The active Crux scope has no compatible host lifetime capability for inline defer().",
    });
  }
  throw createDeferError({
    code: "DEFER_SCOPE_REQUIRED",
    message: "defer() requires an active Crux invocation scope.",
  });
}
