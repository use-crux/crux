/**
 * Build the core-owned {@link CoordinatedStreamPlan} a loop-owning SDK runtime executes
 * (RFC #173, Phase 15, Fork A).
 *
 * Core decides whether coordination is active, counts the shared budget, opens a fresh
 * Safety attempt stream per attempt, applies the shared retry policy to a rejection, and
 * opens/closes the `generation.stream.attempt` span. The runtime supplies nothing but its
 * own SDK execution: it never re-implements policy and core never touches SDK chunks.
 *
 * @module
 */

import type { z } from "zod";
import type { Message } from "../../generation/messages";
import { observe } from "../../observability";
import type { SafetyStream, SafetyStreamSeal } from "../../safety/session";
import type { ConstraintFailure } from "../../safety/constraint/types";
import type { ValidationRetryOptions } from "../../generation/validation-retry";
import { createStreamRetryPolicy } from "./stream-retry-policy";
import { StreamValidationRejection } from "./stream-rejection";
import type { StreamAttemptCause } from "./stream-attempt";
import type {
  CoordinatedStreamPlan,
  SdkAttemptOutcome,
  SdkStreamAttempt,
} from "./stream-attempt-plan";

export interface CoordinatedStreamPlanOptions {
  /** Whether any commit gate (assert or positive validation-retry) is active. */
  readonly active: boolean;
  /** Open a FRESH Safety stream for one attempt (raw: non-terminal rejections propagate). */
  readonly openAttemptSafety: () => SafetyStream;
  /** Whether an attempt must buffer to EOF-and-validate before releasing anything. */
  readonly bufferUntilValidated: boolean;
  /** Authored schema for the core-owned authoritative parse under a validation gate. */
  readonly schema?: z.ZodType;
  readonly maxSteps: number;
  readonly steps: () => number;
  readonly incrementStep: () => void;
  readonly formatFeedback: (failures: readonly ConstraintFailure[]) => readonly Message[];
  readonly validationRetry?: ValidationRetryOptions;
  readonly promptId?: string;
  /** Caller abort/deadline signal; composed into each attempt's signal. */
  readonly signal?: AbortSignal;
  /** Run each attempt-span open/close inside the owning `generation.stream` context. */
  readonly withStreamContext?: <T>(work: () => T) => T | Promise<T>;
}

/** Create the plan handed to a loop-owning SDK runtime. */
export function createCoordinatedStreamPlan(
  options: CoordinatedStreamPlanOptions,
): CoordinatedStreamPlan {
  let acceptedSeal: SafetyStreamSeal | undefined;
  // The validation gate's parse of the committed candidate, so completion publishes THAT
  // parse instead of running the authored schema a second time.
  let committedCandidate: { readonly value: unknown; readonly data: unknown } | undefined;
  const policy = createStreamRetryPolicy({
    maxSteps: options.maxSteps,
    steps: options.steps,
    formatFeedback: options.formatFeedback,
    ...(options.validationRetry ? { validationRetry: options.validationRetry } : {}),
    ...(options.promptId ? { promptId: options.promptId } : {}),
  });

  const startAttempt = async (
    attemptIndex: number,
    cause: StreamAttemptCause,
    corrective: readonly Message[],
  ): Promise<SdkStreamAttempt> => {
    // Budget gate BEFORE consuming a provider call. One step is reserved up front so a
    // runtime that never reports back still cannot run free; the reported count replaces
    // this reservation once the attempt settles.
    if (!policy.canAffordAttempt()) throw policy.budgetExhausted(attemptIndex);
    options.incrementStep();
    const remainingSteps = Math.max(1, options.maxSteps - options.steps() + 1);

    const controller = new AbortController();
    const onAbort = () =>
      controller.abort((options.signal as { reason?: unknown } | undefined)?.reason);
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });

    const open = () =>
      observe.openSpan({
        name: `stream attempt ${attemptIndex}`,
        primitive: "generation.stream.attempt",
        attributes: { attemptIndex, cause },
        implicitRun: false,
      });
    const span = (await (options.withStreamContext
      ? options.withStreamContext(open)
      : open())) as ReturnType<typeof observe.openSpan>;

    let settled = false;
    let reported: { readonly steps: number; readonly resumable: boolean } | undefined;
    const close = (
      outcome: SdkAttemptOutcome,
      failedPolicies?: readonly string[],
    ): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      span.end({
        attributes: {
          attemptIndex,
          cause,
          outcome,
          ...(failedPolicies && failedPolicies.length > 0 ? { failedPolicies } : {}),
        },
      });
    };

    // Track this attempt's seal, but publish it only if the attempt is ACCEPTED — a
    // discarded attempt's seal never reaches completion.
    const rawSafety = options.openAttemptSafety();
    let ownSeal: SafetyStreamSeal | undefined;
    const safety: SafetyStream = {
      feed: (chunk) => rawSafety.feed(chunk),
      async finish() {
        const seal = await rawSafety.finish();
        ownSeal = seal;
        return seal;
      },
      transform: () => rawSafety.transform(),
    };

    return {
      attemptIndex,
      cause,
      corrective,
      safety,
      signal: controller.signal,
      bufferUntilValidated: options.bufferUntilValidated,
      remainingSteps,
      async validateCandidate() {
        // Only a validation-gated attempt validates here; an assert-only attempt was
        // already committed by its gates.
        if (!options.bufferUntilValidated || !options.schema) return;
        const check = options.schema.safeParse(ownSeal?.parsed);
        if (check.success) {
          committedCandidate = { value: ownSeal?.parsed, data: check.data };
          return;
        }
        throw new StreamValidationRejection({
          error: check.error,
          text: ownSeal?.text ?? "",
        });
      },
      reportSteps({ steps, resumable }) {
        if (reported) return;
        // A malformed report is UNKNOWN consumption, not a usable count: leaving
        // `reported` undefined makes the retry path fail closed.
        if (!Number.isSafeInteger(steps) || steps < 1) return;
        // A runtime cannot consume more than it was granted; a larger claim means the
        // budget was already overrun, so treat it as unknown rather than trusting it.
        if (steps > remainingSteps) return;
        reported = { steps, resumable };
        // Deduct what the invocation ACTUALLY consumed beyond the reserved step.
        for (let extra = 1; extra < steps; extra += 1) options.incrementStep();
      },
      accept: () => {
        acceptedSeal = ownSeal;
        close("accepted");
      },
      settle: (outcome) => close(outcome),
      async reject(error) {
        // A rejection is a policy decision, not a provider error.
        const failedPolicies = failedPolicyIds(error);
        close("discarded", failedPolicies);
        controller.abort();
        if (options.signal?.aborted) throw abortReason(options.signal);
        // Retrying is only safe when the runtime can resume from the COMPLETE settled
        // conversation. Unknown consumption or unresumable tool rounds mean a retry could
        // re-execute settled side effects, so fail closed with the original typed error
        // instead of making another provider call.
        // `resumable: false` is non-retryable regardless of the reported count: the
        // runtime is telling us it cannot continue from the settled conversation.
        if (reported === undefined || !reported.resumable) {
          policy.terminal(error, attemptIndex);
        }
        // Throws the typed public terminal error when no retry is available.
        const grant = policy.onRejection(error, attemptIndex);
        return startAttempt(attemptIndex + 1, grant.cause, grant.corrective);
      },
    };
  };

  return {
    active: options.active,
    beginAttempt: () => startAttempt(0, "initial", []),
    acceptedSeal: () => acceptedSeal,
    committedCandidate: () => committedCandidate,
  };
}

function failedPolicyIds(error: unknown): readonly string[] | undefined {
  const failures = (error as { failures?: readonly { name: string }[] }).failures;
  return failures?.map((failure) => failure.name);
}

function abortReason(signal: AbortSignal): Error {
  const reason = (signal as { reason?: unknown }).reason;
  return reason instanceof Error ? reason : new DOMException("Aborted", "AbortError");
}
