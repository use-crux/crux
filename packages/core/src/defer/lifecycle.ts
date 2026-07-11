/**
 * First-party lifecycle capability factories for Crux host integrations.
 *
 * This coordinated SPI is not a supported third-party adapter API.
 *
 * @internal
 * @module
 */

import type {
  DeferLifetimeCapability,
  DeferLifetimeLimits,
  DeferScheduledTask,
} from "./host-types";

export type { DeferLifetimeLimits } from "./host-types";

/** Options for a handler-returned lifetime capability. */
export interface HandlerReturnedLifetimeOptions {
  readonly limits: DeferLifetimeLimits;
  readonly durableFinalization: boolean;
  readonly handoff: (promise: Promise<void>) => void;
}

/** Create a capability whose work starts when its handler returns. */
export function createHandlerReturnedDeferLifetime(
  options: HandlerReturnedLifetimeOptions,
): DeferLifetimeCapability {
  return Object.freeze({
    completion: "handler-returned" as const,
    limits: options.limits,
    durableFinalization: options.durableFinalization,
    schedule(task: DeferScheduledTask): void {
      let promise: Promise<void>;
      try {
        promise = task.run();
      } catch (error) {
        promise = Promise.reject(error);
      }
      options.handoff(promise);
    },
  });
}

/** Terminal controls supplied to a response-finished host binding. */
export interface ResponseFinishedTerminal {
  finish(): void;
  cancel(reason?: unknown): void;
}

/** Options for a response-finished lifetime capability. */
export interface ResponseFinishedLifetimeOptions {
  readonly limits: DeferLifetimeLimits;
  readonly durableFinalization: boolean;
  readonly subscribe: (terminal: ResponseFinishedTerminal) => () => void;
  readonly start: (task: DeferScheduledTask) => void;
}

/** Create a capability whose work starts at an explicit response terminal. */
export function createResponseFinishedDeferLifetime(
  options: ResponseFinishedLifetimeOptions,
): DeferLifetimeCapability {
  let task: DeferScheduledTask | undefined;
  let state: "pending" | "finished" | "cancelled" = "pending";
  let started = false;
  let cancellationReason: unknown;
  let unsubscribe: (() => void) | undefined;
  let unsubscribed = false;

  function removeSubscription(): void {
    if (unsubscribed || !unsubscribe) return;
    unsubscribed = true;
    unsubscribe();
  }

  function startIfReady(): void {
    if (state !== "finished" || !task || started) return;
    started = true;
    options.start(task);
  }

  const terminal: ResponseFinishedTerminal = Object.freeze({
    finish(): void {
      if (state !== "pending") return;
      state = "finished";
      removeSubscription();
      startIfReady();
    },
    cancel(reason?: unknown): void {
      if (state !== "pending") return;
      state = "cancelled";
      cancellationReason = reason;
      removeSubscription();
      task?.cancel(reason);
    },
  });

  unsubscribe = once(options.subscribe(terminal));
  if (state !== "pending") removeSubscription();

  return Object.freeze({
    completion: "response-finished" as const,
    limits: options.limits,
    durableFinalization: options.durableFinalization,
    schedule(nextTask: DeferScheduledTask): void {
      if (task) {
        throw new TypeError("A defer lifetime may schedule only one task.");
      }
      task = nextTask;
      if (state === "cancelled") {
        task.cancel(cancellationReason);
        return;
      }
      startIfReady();
    },
  });
}

function once(callback: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    callback();
  };
}
