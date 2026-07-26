/**
 * Provider-neutral coordinated-stream plan for loop-owning SDK runtimes
 * (RFC #173, Phase 15, Fork A).
 *
 * The boundary is: **core coordinates WHY and WHETHER to retry; the SDK runtime
 * coordinates HOW an SDK stream is physically represented.** Core never inspects or
 * reconstructs SDK chunk variants; the runtime never re-implements retry policy.
 *
 * Core supplies this plan (commit gates, shared budget, retry eligibility, corrective
 * messages, a fresh Safety attempt-stream factory, typed rejection handling, settlement
 * and audit sinks, attempt signal/context). The runtime executes it against its own
 * gateway — invoking the SDK per attempt, consuming SDK attempt events, discarding a
 * rejected attempt without surfacing any of it, and composing ONE logical SDK-shaped
 * stream result for the caller.
 *
 * @module
 */

import type { Message } from "../../generation/messages";
import type { SafetyStream } from "../../safety/session";
import type { StreamAttemptCause } from "./stream-attempt";

/** How one SDK attempt ended, reported back so core can close its attempt span. */
export type SdkAttemptOutcome = "accepted" | "discarded" | "failed" | "cancelled";

/** One attempt's coordination handle, obtained from {@link CoordinatedStreamPlan.beginAttempt}. */
export interface SdkStreamAttempt {
  /** Zero-based index of this attempt within the logical operation. */
  readonly attemptIndex: number;
  /** Why this attempt exists (`initial`, or which retry kind). */
  readonly cause: StreamAttemptCause;
  /** Corrective messages to append before re-invoking the SDK (empty on the initial attempt). */
  readonly corrective: readonly Message[];
  /**
   * A FRESH Safety stream for this attempt: the runtime feeds provider text deltas to
   * it and forwards only released content. It raises the internal non-terminal
   * rejection on an `assert` failure — the runtime must not translate or swallow it,
   * only pass it to {@link reject}.
   */
  readonly safety: SafetyStream;
  /** Aborted when this attempt is discarded; the runtime must stop its SDK stream. */
  readonly signal: AbortSignal;
  /**
   * Whether this attempt must buffer every byte until the candidate validates
   * (an EOF-and-validate commit gate). When false, released content may flow as soon
   * as the commit gates allow (early unlock).
   */
  readonly bufferUntilValidated: boolean;
  /**
   * Logical steps this attempt may consume from the shared `maxSteps` budget.
   *
   * @remarks
   * One SDK invocation is NOT one step: a loop-owning runtime may run several model
   * steps (tool rounds) inside a single call. The runtime must map this to its own stop
   * condition so it cannot exceed the shared budget, and must report what it actually
   * consumed through {@link reportSteps}.
   */
  readonly remainingSteps: number;
  /**
   * Report how many model steps this attempt actually consumed, and whether its
   * conversation can be safely resumed.
   *
   * @remarks
   * Call before {@link accept} or {@link reject}. `steps` must be at least 1. Core
   * deducts the reported count from the shared budget instead of assuming one.
   *
   * `resumable` states whether the runtime can continue from the COMPLETE settled
   * conversation — including tool calls and their results — without re-executing them.
   * Replaying only the rejected assistant text is not resumable: a retry would run
   * settled side-effecting tools again. When this is not reported, or reports
   * `resumable: false` after tool rounds, core fails closed and surfaces the original
   * typed terminal error rather than making another provider call.
   */
  reportSteps(consumed: { readonly steps: number; readonly resumable: boolean }): void;
  /**
   * Run core's authoritative validation of this attempt's completed candidate.
   *
   * @remarks
   * The runtime supplies the completed attempt (by sealing its {@link safety} stream);
   * core owns the parse against the AUTHORED schema. Call after the attempt completes
   * and BEFORE {@link accept}, so an invalid candidate publishes no text and no non-text
   * parts. Throws {@link StreamValidationRejection}, which the runtime hands to
   * {@link reject} to retry or surface the typed terminal error.
   *
   * A no-op when this attempt carries no validation gate.
   */
  validateCandidate(): Promise<void>;
  /**
   * Report a rejection (constraint or validation) raised while consuming this attempt.
   * Core decides eligibility and either schedules another attempt or throws the typed
   * public error. Returns the next attempt when a retry is granted, else `undefined`
   * (core then throws — the runtime should surface that failure on the logical stream).
   */
  reject(error: unknown): Promise<SdkStreamAttempt | undefined>;
  /** Accept this attempt's completed candidate as the published logical result. */
  accept(): void;
  /** Report a non-policy ending so the attempt span closes truthfully. */
  settle(outcome: SdkAttemptOutcome): void;
}

/**
 * Core-owned coordination plan handed to a loop-owning SDK runtime.
 *
 * When {@link active} is false the runtime MUST take its untouched single-attempt fast
 * path (raw object identity preserved). When true it drives attempts through
 * {@link beginAttempt} and composes one logical SDK-shaped result.
 */
export interface CoordinatedStreamPlan {
  /** Whether any commit gate (assert or validation-retry) can reject an attempt. */
  readonly active: boolean;
  /** Begin the first attempt. Subsequent attempts come from {@link SdkStreamAttempt.reject}. */
  beginAttempt(): Promise<SdkStreamAttempt>;
  /**
   * The seal of the ACCEPTED attempt's Safety stream, once that attempt sealed — the
   * guarded text, the canonical object, and its occurrence settlement. Core's completion
   * consumes it so the published result is the accepted candidate's (a discarded
   * attempt's seal is never exposed). `undefined` until an attempt has sealed.
   */
  acceptedSeal(): import("../../safety/session").SafetyStreamSeal | undefined;
  /**
   * The validation gate's parse of the accepted candidate, when one was gated.
   *
   * Completion publishes this `data` rather than parsing again, so a transform or
   * refinement runs exactly once per candidate on this route too.
   */
  committedCandidate(): { readonly value: unknown; readonly data: unknown } | undefined;
}
