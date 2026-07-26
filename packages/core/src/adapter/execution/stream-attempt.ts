/**
 * Shared provider-neutral stream-attempt coordinator (RFC #173, Phase 15).
 *
 * One coordinator owns the logical retry loop for BOTH the native and SDK stream
 * routes so their semantics cannot drift: shared `maxSteps` step accounting,
 * corrective-message progression, discarded-versus-accepted state, cumulative
 * constraint audit, and publishing only the accepted attempt. Each route supplies
 * a `startAttempt` callback that runs one fresh provider stream + Safety attempt
 * and exposes it as a {@link StreamAttemptRun}; the coordinator never sees provider
 * internals.
 *
 * The coordinator buffers until COMMITMENT, not completion. It has two states:
 * `pre-commit` — the attempt's commit gate(s) hold every consumer-visible byte, so
 * a rejection can discard the attempt and retry with no leaked output; and
 * `committed` — the moment the commit gate proves the attempt can no longer be
 * rejected, at which point the accepted prefix flushes and the SAME attempt
 * continues progressively (retry is then illegal). Early unlock is preserved: a
 * scalar-path `assert` that resolves mid-stream releases its buffered prefix before
 * provider EOF rather than waiting for the seal.
 *
 * Safety evaluates an individual attempt but never decides retry eligibility — an
 * `assert` rejection is an internal, explicitly non-terminal verdict
 * ({@link StreamConstraintRejection}). The coordinator consumes it and retries when
 * eligible; when the shared budget or per-constraint retries are exhausted it
 * constructs the single public {@link ConstraintViolationError} with cumulative
 * attempts/audit. A standalone `Safety.openStream()` (no regeneration authority)
 * translates the same rejection to that public error directly.
 *
 * @module
 */

import type { Message } from "../../generation/messages";
import type { SafetyStreamSeal } from "../../safety/session";
import type { ConstraintAuditEntry, ConstraintFailure } from "../../safety/constraint/types";
import type {
  ConstraintSettlement,
  StreamConstraintFailure,
} from "../../safety/constraint/settlement";
import { isStreamConstraintRejection } from "../../safety/constraint/settlement";
import type { ValidationRetryOptions } from "../../generation/validation-retry";
import type { ConstraintViolationError } from "../../safety/constraint/errors";
import { isStreamValidationRejection } from "./stream-rejection";
import { createStreamRetryPolicy } from "./stream-retry-policy";

export type { ConstraintSettlement } from "../../safety/constraint/settlement";
export { StreamValidationRejection } from "./stream-rejection";

/** A candidate-bound failed `assert` with its per-constraint retry ceiling. */
export type StreamAttemptFailure = StreamConstraintFailure;

/**
 * One coordinator event emitted while consuming a single attempt's released
 * output. `delta` carries released bytes; exactly one `committed` marks the commit
 * transition (retry is illegal after it); the terminal `sealed` carries the
 * accepted seal + settlement. Consuming an attempt's {@link StreamAttemptRun.events}
 * throws {@link StreamConstraintRejection} when an `assert` rejects the still
 * uncommitted attempt.
 */
export type StreamAttemptEvent =
  | { readonly kind: "delta"; readonly text: string }
  | { readonly kind: "committed" }
  | {
      readonly kind: "sealed";
      readonly seal: SafetyStreamSeal;
      readonly settlement: ConstraintSettlement;
    };

/** One in-flight provider stream + Safety attempt the coordinator drives. */
export interface StreamAttemptRun {
  /**
   * This attempt's released output as coordinator events. Pre-commit deltas are
   * held by the commit gate (there are none to forward); the sole `committed`
   * event flushes the accepted prefix; `sealed` ends it. Throws
   * {@link StreamConstraintRejection} on an `assert` rejection (always pre-commit).
   */
  readonly events: AsyncIterable<StreamAttemptEvent>;
  /** Abort the provider stream and release attempt-local resources. */
  abort(): Promise<void>;
  /**
   * Report how this attempt ended so its `generation.stream.attempt` span closes
   * with a truthful outcome. A constraint/validation rejection is `discarded`
   * (a policy decision), not a provider error.
   */
  settleOutcome?(
    outcome: "accepted" | "discarded" | "failed" | "cancelled",
    failedPolicies?: readonly string[],
  ): void;
}

/** Why the coordinator started this attempt — the `generation.stream.attempt` cause. */
export type StreamAttemptCause = "initial" | "constraint-retry" | "validation-retry";

/** Start one fresh provider stream + Safety attempt over `corrective` within `signal`. */
export type StreamAttemptStart = (params: {
  readonly corrective: readonly Message[];
  readonly attemptIndex: number;
  readonly cause: StreamAttemptCause;
  readonly signal: AbortSignal;
}) => Promise<StreamAttemptRun>;

export interface CoordinatedStreamOptions {
  readonly startAttempt: StreamAttemptStart;
  /** Shared logical-operation provider-call budget (same as generate). */
  readonly maxSteps: number;
  /** Current shared step count (validation + constraint retries share it). */
  readonly steps: () => number;
  /** Count one provider call against the shared budget. */
  readonly incrementStep: () => void;
  /** Build corrective messages from the rejected attempt's failures. */
  readonly formatFeedback: (
    failures: readonly ConstraintFailure[],
  ) => readonly Message[];
  /** Caller abort/deadline signal; cancels the active attempt and stops retries. */
  readonly signal?: AbortSignal;
  readonly promptId?: string;
  /** Announce a retry (attempt index → next, with sanitized failed ids). */
  readonly onRetry?: (attemptIndex: number, failedIds: readonly string[]) => void;
  /**
   * Validation-retry policy shared with the same loop (Fork 2). When present with
   * `maxRetries > 0`, a {@link StreamValidationRejection} is retried under the shared
   * budget until validation passes or `maxRetries` is reached, then the coordinator
   * throws {@link ValidationExhaustedError} (never a combined error). `onRetry`/
   * `onExhausted` fire with the same counts as generate.
   */
  readonly validationRetry?: ValidationRetryOptions;
}

/** The accepted attempt plus cumulative retry accounting. */
export interface AcceptedStreamAttempt {
  readonly seal: SafetyStreamSeal;
  /** The accepted candidate's OWN settlement (never merged with discarded attempts). */
  readonly settlement: ConstraintSettlement;
  readonly attempts: number;
  /**
   * Audit history from DISCARDED attempts only, kept separate from the accepted
   * candidate's {@link settlement} so the accepted result never loses the
   * accumulated audit and no discarded settlement crosses into it.
   */
  readonly cumulativeAudit: readonly ConstraintAuditEntry[];
}

/**
 * A coordinated stream/handle: released deltas of the ACCEPTED attempt (early
 * unlock preserved) plus a completion promise tracking that accepted attempt.
 */
export interface CoordinatedStream {
  /** Released canonical deltas of the accepted attempt only. */
  readonly deltas: AsyncIterable<string>;
  /**
   * Resolves to the accepted attempt once its stream drains; rejects with the
   * public {@link ConstraintViolationError} when retries are exhausted, or with the
   * caller's abort reason. Safe to await without consuming {@link deltas}.
   */
  completion(): Promise<AcceptedStreamAttempt>;
}

/**
 * Drive the shared buffer-until-commitment stream loop: run attempts until one
 * commits, forwarding only the accepted attempt's released deltas; a pre-commit
 * rejection discards the attempt and retries when eligible (shared budget AND at
 * least one failed constraint under its per-constraint ceiling), else throws the
 * single public {@link ConstraintViolationError}.
 */
export function runCoordinatedStream(
  options: CoordinatedStreamOptions,
): CoordinatedStream {
  const out = createStringChannel();
  const drivePromise = driveLoop(options, out);
  // The failure surfaces through `deltas` (out.fail) AND `completion()`; mark the
  // drive promise handled so consuming only one of them is not an unhandled rejection.
  void drivePromise.catch(() => {});
  return {
    deltas: out,
    completion: () => drivePromise,
  };
}

async function driveLoop(
  options: CoordinatedStreamOptions,
  out: StringChannel,
): Promise<AcceptedStreamAttempt> {
  // Retry policy lives in one shared kernel so the native and SDK routes cannot drift.
  const policy = createStreamRetryPolicy({
    maxSteps: options.maxSteps,
    steps: options.steps,
    formatFeedback: options.formatFeedback,
    ...(options.validationRetry ? { validationRetry: options.validationRetry } : {}),
    ...(options.promptId ? { promptId: options.promptId } : {}),
    ...(options.onRetry ? { onRetry: options.onRetry } : {}),
  });
  let corrective: readonly Message[] = [];
  let attemptIndex = 0;
  let cause: StreamAttemptCause = "initial";

  try {
    for (;;) {
      if (options.signal?.aborted) throw abortError(options.signal);

      // Budget gate BEFORE consuming a provider call: never start (or count) an
      // attempt the shared budget cannot afford.
      if (!policy.canAffordAttempt()) throw policy.budgetExhausted(attemptIndex);
      options.incrementStep();

      const controller = new AbortController();
      const onAbort = () =>
        controller.abort((options.signal as { reason?: unknown } | undefined)?.reason);
      options.signal?.addEventListener("abort", onAbort, { once: true });

      let run: StreamAttemptRun | undefined;
      try {
        run = await options.startAttempt({
          corrective,
          attemptIndex,
          cause,
          signal: controller.signal,
        });
        let committed = false;
        for await (const event of run.events) {
          if (event.kind === "committed") {
            committed = true;
          } else if (event.kind === "delta") {
            // Pre-commit deltas are held by the commit gate; only accepted
            // (committed) output reaches the consumer. Post-commit deltas are
            // enqueued for replay: the channel does NOT apply backpressure, because
            // `completion()` must settle even when nobody drains `deltas`.
            if (committed && event.text.length > 0) await out.push(event.text);
          } else {
            run.settleOutcome?.("accepted");
            return {
              seal: event.seal,
              settlement: event.settlement,
              attempts: attemptIndex + 1,
              cumulativeAudit: policy.cumulativeAudit(),
            };
          }
        }
        // The attempt ended without a seal or a rejection: nothing to publish.
        throw new Error("stream attempt ended without sealing");
      } catch (error) {
        const rejection =
          isStreamConstraintRejection(error) || isStreamValidationRejection(error);
        if (!rejection) {
          run?.settleOutcome?.(options.signal?.aborted ? "cancelled" : "failed");
          throw error;
        }
        // A rejection is a POLICY decision, not a provider error: the attempt
        // ends `discarded`. Abort AND await cleanup before deciding eligibility.
        run?.settleOutcome?.(
          "discarded",
          isStreamConstraintRejection(error)
            ? error.failures.map((failure) => failure.name)
            : undefined,
        );
        await run?.abort();
        // The shared policy decides: it returns the retry grant, or throws the typed
        // public terminal error (validation vs constraint — never combined).
        if (options.signal?.aborted) throw abortError(options.signal);
        const grant = policy.onRejection(error, attemptIndex);
        corrective = grant.corrective;
        cause = grant.cause;
        attemptIndex += 1;
      } finally {
        options.signal?.removeEventListener("abort", onAbort);
      }
    }
  } catch (error) {
    out.fail(error);
    throw error;
  } finally {
    out.close();
  }
}

function abortError(signal: AbortSignal): Error {
  const reason = (signal as { reason?: unknown }).reason;
  return reason instanceof Error ? reason : new DOMException("Aborted", "AbortError");
}

// ── Backpressured rendezvous channel ───────────────────────────────
//
// The drive loop runs as its own task and its lifecycle is INDEPENDENT of consumption:
// `push` never waits for a consumer, so `completion()` resolves or rejects even when the
// caller only awaits completion and never iterates `deltas` (a rendezvous handoff here
// deadlocked that case). A consumer that is already waiting is still woken immediately,
// so the accepted attempt streams progressively rather than only at the end.
//
// Buffering is bounded by the accepted attempt's own released text, which Safety already
// retains in full, so this costs no additional retention. Values are replayable: a
// consumer that attaches late still receives every delta in order.

interface StringChannel extends AsyncIterable<string> {
  /** Enqueue one value for the consumer. Never blocks on consumption. */
  push(value: string): Promise<void>;
  close(): void;
  fail(error: unknown): void;
}

function createStringChannel(): StringChannel {
  const queue: string[] = [];
  let closed = false;
  let abandoned = false;
  let failure: unknown;
  let wakeConsumer: (() => void) | undefined;

  const notifyConsumer = () => {
    const resume = wakeConsumer;
    wakeConsumer = undefined;
    resume?.();
  };

  return {
    push(value) {
      // Resolves immediately: the drive loop must be able to finish (and `completion()`
      // settle) whether or not anyone is reading `deltas`.
      if (!closed && failure === undefined && !abandoned) {
        queue.push(value);
        notifyConsumer();
      }
      return Promise.resolve();
    },
    close() {
      if (closed) return;
      closed = true;
      notifyConsumer();
    },
    fail(error) {
      if (failure === undefined) failure = error ?? new Error("stream failed");
      notifyConsumer();
    },
    async *[Symbol.asyncIterator]() {
      try {
        for (;;) {
          if (queue.length > 0) {
            yield queue.shift() as string;
            continue;
          }
          if (failure !== undefined) throw failure;
          if (closed) return;
          await new Promise<void>((resolve) => {
            wakeConsumer = resolve;
          });
        }
      } finally {
        // A consumer that stops early stops buffering too; the drive loop is unaffected
        // because it never awaited consumption.
        abandoned = true;
        queue.length = 0;
      }
    },
  };
}
