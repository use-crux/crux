import type { Message } from "../generation/messages";
import type { TraceMeta } from "../generation/types";
import type { z } from "zod";
import type { SafetyTuneOptions } from "./tune";
import type { Constraint, ConstraintFailure } from "./constraint/types";
import type { Guardrail } from "./guardrail/types";
import type { SafetyAudit } from "./audit";

// Public types
// ─────────────────────────────────────────────────────────────────

/** Options for {@link createSafety} — one session per generate/stream call. */
export interface SafetyCallOptions {
  /** Per-call overrides (highest precedence). Rarely used; usually omitted. */
  readonly call?: {
    readonly constraints?: readonly Constraint[];
    readonly guardrails?: readonly Guardrail[];
    /** Shared cap on total constraint retries across all constraints. */
    readonly constraintMaxRetries?: number;
  };
  /** The resolved prompt — the session reads constraints/guardrails/metadata itself. */
  readonly resolved?: {
    readonly constraints?: readonly Constraint[];
    readonly guardrails?: readonly Guardrail[];
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  /** Identity threaded into spans, audits, and hook payloads. */
  readonly promptId: string | undefined;
  readonly model: string | undefined;
  readonly traceId?: string;
  readonly systemPrompt?: string;
  /**
   * Injectable corrective-message formatting (localization, structured
   * feedback). The default reproduces the stock English phrasing
   * byte-for-byte.
   */
  readonly formatter?: ConstraintFeedbackFormatter;
  /**
   * Explicit per-call safety posture overrides keyed by policy id.
   *
   * Tuning can only adjust enforcement/reporting, stream posture, or whether
   * an attached policy is enabled for this call. It never replaces policy
   * logic, boundaries, or identity.
   */
  readonly safety?: SafetyTuneOptions;
  // Global scope (runtime globals) is read internally — callers never touch the registry.
}

/** The output under safety evaluation: final text plus the parsed object for structured prompts. */
export interface SafetyOutput {
  readonly text: string;
  readonly parsed?: unknown;
}

/** Call-identity context handed to {@link ConstraintFeedbackFormatter}. */
export interface SafetyContext {
  readonly promptId: string | undefined;
  readonly model: string | undefined;
  readonly traceId: string | undefined;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Formats the corrective message injected before a constraint-driven
 * regeneration. Return a string for a single user message, or full
 * `Message`s for structured feedback. The default formatter produces:
 *
 * ```
 * Your previous output did not satisfy the following quality constraints. Please fix all issues in your next response.
 *
 * [constraint-name]: feedback
 * ```
 */
export interface ConstraintFeedbackFormatter {
  format(
    failures: readonly ConstraintFailure[],
    ctx: SafetyContext,
  ): string | readonly Message[];
}

/**
 * Machine-readable protocol trace for the dialect parity suite: both
 * dialects must produce identical event sequences for the same inputs.
 */
export type SafetyProtocolEvent =
  | {
      readonly t: "input.guard";
      readonly guards: number;
      readonly actions: readonly string[];
    }
  | {
      readonly t: "constraint.round";
      readonly attempt: number;
      readonly verdict: "retry" | "accept";
    }
  | { readonly t: "suspend" }
  | {
      readonly t: "output.guard";
      readonly guards: number;
      readonly actions: readonly string[];
    }
  | { readonly t: "stream.chunk"; readonly directive: "emit" | "hold" }
  | { readonly t: "stream.finish" }
  | { readonly t: "stamp" };

/** Verdict for one fed stream chunk. */
export type SafetyStreamDirective =
  | { readonly kind: "emit"; readonly content: string }
  | { readonly kind: "hold" };

/**
 * Final seal of a guarded stream. `text` is the complete guarded output
 * (for audits and memory); `pending` is the tail not yet released through
 * `feed()` — the dialect must forward it to the consumer before closing.
 */
export interface SafetyStreamSeal extends SafetyOutput {
  readonly pending: string;
}

/**
 * Streaming sub-protocol for one model output stream.
 *
 * Text flows through a gated stage cascade: each stage consumes the cleared
 * output of the previous stage, and content is emitted only after every
 * enforcing stream guard has allowed, rewritten, or warned on the segment.
 * Constraints run report-only at `finish()` because a live stream cannot
 * regenerate earlier text.
 */
export interface SafetyStream {
  /**
   * Feed one chunk. `emit` content may differ from the fed chunk (held
   * content released after an async fix, transformed/redacted text).
   * `hold` means emit nothing — the session is buffering pending a verdict.
   * Throws {@link GuardrailBlockedError} on block (dialect errors its
   * controller) and {@link ConstraintViolationError} on a constraint
   * `onChunk` abort.
   */
  feed(chunk: string): Promise<SafetyStreamDirective>;

  /**
   * End of stream: flush held segments, run final-only guards and
   * report-mode constraints, then return the final seal.
   */
  finish(): Promise<SafetyStreamSeal>;

  /** Convenience pipe-through for TransformStream-based dialects. */
  transform(): TransformStream<string, string>;
}

/**
 * A per-call safety session. Create with {@link createSafety}; drive
 * `guardInput()` → `finalizeOutput()` → `stamp()` (or `openStream()` for
 * streamed runs).
 */
export interface Safety {
  /** False when nothing applies — all methods become no-op passthroughs. */
  readonly enabled: boolean;

  /**
   * Input boundary pass.
   *
   * Runs input guardrails over every user message in order. Rewrites are
   * written back into the returned messages before the provider sees them.
   * If no user message exists, the optional prompt fallback is guarded.
   * Throws {@link GuardrailBlockedError} on block.
   */
  guardInput(input: {
    readonly messages: readonly Message[];
    readonly prompt?: string;
    /** Canonical system/model instruction text, guarded independently from user content. */
    readonly system?: string;
  }): Promise<{
    readonly messages: readonly Message[];
    readonly prompt?: string;
    /** Guarded system text that generation callers must pass to the provider. */
    readonly system?: string;
  }>;

  /**
   * Output boundary pass.
   *
   * Fixed order: output guardrails first, then constraints over the guarded
   * candidate. Constraint retries call `regenerate`, guard the regenerated
   * candidate, and then re-check constraints. `suspended: true`
   * (tool-approval) skips output safety because the response is an approval
   * request, not final model output. Throws
   * {@link ConstraintViolationError} / {@link GuardrailBlockedError}.
   *
   * `regenerate` is the only dialect-specific concern: append the
   * corrective messages to the conversation, re-call the model, re-run
   * structural validation, and return the new output.
   */
  finalizeOutput(
    output: SafetyOutput,
    regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
    opts?: {
      readonly suspended?: boolean;
      readonly messages?: readonly Message[];
      readonly schema?: z.ZodType;
    },
  ): Promise<SafetyOutput>;

  /**
   * Guard provider-completed text slots independently and in order.
   *
   * This completion-only path runs output guardrails and records their audit,
   * but never evaluates constraints or regenerates. Streaming constraints stay
   * owned by {@link SafetyStream.finish} over the aggregate emitted text.
   *
   * @internal Adapter execution only.
   */
  guardOutputTextParts(parts: readonly string[]): Promise<readonly string[]>;

  /** Audits accumulated so far (exact `GuardrailAudit` / `ConstraintAudit` shapes). */
  readonly audit: SafetyAudit;

  /** Return `meta` with audit fields attached iff non-empty. */
  stamp<TMeta extends TraceMeta>(meta: TMeta): TMeta;

  /** Open the streaming sub-protocol for one streamed response. */
  openStream(): SafetyStream;

  /** Protocol transcript — see {@link SafetyProtocolEvent}. */
  readonly transcript: readonly SafetyProtocolEvent[];
}
