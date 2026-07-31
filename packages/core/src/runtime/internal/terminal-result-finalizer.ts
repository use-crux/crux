/**
 * Private terminal-result coordinator for middleware-owned deferred work.
 *
 * Middleware such as semantic cache must settle adapter lifecycle publication
 * before it stores or releases an accepted result.
 *
 * @module
 * @internal
 */

import type { MiddlewareResult, PromptMiddleware } from "../types";

type PromptMiddlewareNext = Parameters<PromptMiddleware>[1];
type DeferredResultFinalizer = (
  result: MiddlewareResult,
) => Promise<MiddlewareResult>;

export interface TerminalResultCoordinator {
  readonly deferred: DeferredResultFinalizer[];
}

const terminalResultCoordinator: unique symbol = Symbol(
  "crux.terminalResultCoordinator",
);

type TerminalResultCarrier = {
  readonly [terminalResultCoordinator]?: TerminalResultCoordinator;
};

/** Create the coordinator owned by one generation operation. */
export function createTerminalResultCoordinator(): TerminalResultCoordinator {
  return { deferred: [] };
}

/** Attach a terminal coordinator to a middleware continuation. */
export function attachTerminalResultCoordinator(
  next: PromptMiddlewareNext,
  coordinator: TerminalResultCoordinator,
): PromptMiddlewareNext {
  Object.defineProperty(next, terminalResultCoordinator, {
    value: coordinator,
    enumerable: false,
  });
  return next;
}

/** Forward terminal coordination through a composed continuation. */
export function inheritTerminalResultCoordinator<
  TTarget extends PromptMiddlewareNext,
>(source: PromptMiddlewareNext, target: TTarget): TTarget {
  const coordinator = (source as PromptMiddlewareNext & TerminalResultCarrier)[
    terminalResultCoordinator
  ];
  return coordinator
    ? attachTerminalResultCoordinator(target, coordinator) as TTarget
    : target;
}

/** Register work that must receive the fully composed accepted result. */
export function deferTerminalResult(
  carrier: object,
  finalizer: DeferredResultFinalizer,
): boolean {
  const coordinator = (carrier as TerminalResultCarrier)[
    terminalResultCoordinator
  ];
  if (!coordinator) return false;
  coordinator.deferred.push(finalizer);
  return true;
}

/** Run deferred work over the fully composed accepted result in order. */
export async function finalizeTerminalResult(
  coordinator: TerminalResultCoordinator,
  result: MiddlewareResult,
): Promise<MiddlewareResult> {
  let finalized = result;
  for (const finalizer of coordinator.deferred) {
    finalized = await finalizer(finalized);
  }
  return finalized;
}
