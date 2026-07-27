/** Task-only Eval deadline controller and terminal race. @internal */

import { TimeoutError } from "../../generation/timeout";
import { runWithPreparedEvalTaskContext } from "./task-context-scope";
import type { EvalTaskTimeout } from "../task-context";
import type { EvalCellObservationSnapshot } from "./cell-observation";
import type { EvalCellTimeout } from "./types";

/** Injected clock/timer boundary for deterministic cell-deadline tests. */
export interface CellDeadlineClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export type CellDeadlineResult<T> =
  | {
      readonly status: "completed";
      readonly value: T;
    }
  | {
      readonly status: "timed_out";
      readonly timeout: EvalCellTimeout;
      readonly durationMs: number;
      readonly observation: EvalCellObservationSnapshot;
    };

const platformDeadlineClock: CellDeadlineClock = Object.freeze({
  now: Date.now,
  setTimer: (callback: () => void, delayMs: number) =>
    setTimeout(callback, delayMs),
  clearTimer: (handle: unknown) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
});

/**
 * Run one live task with a stable signal and optional Eval-owned total limit.
 *
 * The losing task remains cooperatively cancelled; the race retains its
 * rejection consumer so a late failure cannot become unhandled.
 */
export async function runWithCellDeadline<T>(input: {
  readonly totalMs: number | null | undefined;
  /** Optional absolute-deadline remainder distinct from reported limit. */
  readonly delayMs?: number;
  readonly timeout: EvalTaskTimeout;
  readonly task: () => Promise<T>;
  readonly timeoutFromValue?: (value: T) => EvalCellTimeout | undefined;
  readonly expire: (abort: {
    readonly timeout: EvalCellTimeout;
    abort(): void;
  }) => EvalCellObservationSnapshot;
  readonly clock?: CellDeadlineClock;
}): Promise<CellDeadlineResult<T>> {
  const clock = input.clock ?? platformDeadlineClock;
  const startedAt = clock.now();
  const controller = new AbortController();
  const task = Promise.resolve().then(() =>
    runWithPreparedEvalTaskContext(
      { signal: controller.signal, timeout: input.timeout },
      input.task,
    ),
  );
  if (typeof input.totalMs !== "number") {
    return terminalTaskResult(await task, input, controller, clock, startedAt);
  }

  const timeout = Object.freeze({
    budget: "total" as const,
    limitMs: input.totalMs,
  });
  const deadline = armDeadline(clock, input.delayMs ?? input.totalMs, () =>
    input.expire({
      timeout,
      abort: () => controller.abort(new TimeoutError(timeout)),
    }),
  );
  try {
    return await Promise.race([
      task.then((value) =>
        terminalTaskResult(value, input, controller, clock, startedAt),
      ),
      deadline.result.then((observation) =>
        Object.freeze({
          status: "timed_out" as const,
          timeout,
          durationMs: Math.max(0, clock.now() - startedAt),
          observation,
        }),
      ),
    ]);
  } finally {
    clock.clearTimer(deadline.handle);
  }
}

function terminalTaskResult<T>(
  value: T,
  input: {
    readonly timeoutFromValue?: (value: T) => EvalCellTimeout | undefined;
    readonly expire: (abort: {
      readonly timeout: EvalCellTimeout;
      abort(): void;
    }) => EvalCellObservationSnapshot;
  },
  controller: AbortController,
  clock: CellDeadlineClock,
  startedAt: number,
): CellDeadlineResult<T> {
  const timeout = input.timeoutFromValue?.(value);
  if (timeout === undefined) {
    return Object.freeze({ status: "completed", value });
  }
  const observation = input.expire({
    timeout,
    abort: () => controller.abort(new TimeoutError(timeout)),
  });
  return Object.freeze({
    status: "timed_out",
    timeout,
    durationMs: Math.max(0, clock.now() - startedAt),
    observation,
  });
}

function armDeadline(
  clock: CellDeadlineClock,
  delayMs: number,
  expire: () => EvalCellObservationSnapshot,
): {
  readonly handle: unknown;
  readonly result: Promise<EvalCellObservationSnapshot>;
} {
  let resolveDeadline:
    | ((observation: EvalCellObservationSnapshot) => void)
    | undefined;
  const result = new Promise<EvalCellObservationSnapshot>((resolve) => {
    resolveDeadline = resolve;
  });
  const handle = clock.setTimer(() => {
    resolveDeadline?.(expire());
  }, delayMs);
  return Object.freeze({ handle, result });
}
