/**
 * The per-call `Safety` session — the single consumption entry point for
 * guardrails and constraints.
 *
 * Authoring stays with `guardrail()` and `constraint()`. Execution goes
 * through one session per `generate()`/`stream()` call, created with
 * {@link createSafety}. The session owns everything the adapter dialects
 * used to coordinate by hand:
 *
 * - Policy registry construction across global, prompt, and call scopes.
 *   Duplicate policy ids fail fast, and callers tune posture explicitly with
 *   `safety.tune` instead of relying on implicit override precedence.
 * - Boundary splitting and input guarding for every user message, including
 *   redaction/rewrite write-back before provider execution.
 * - The guardrails-before-constraints convergence loop and corrective-message
 *   phrasing (injectable via {@link ConstraintFeedbackFormatter}).
 * - Suspension policy: output safety is skipped on tool-approval suspension.
 * - Instrumentation hook fan-out and all safety observability emission.
 * - Audit accumulation across phases and `TraceMeta` shaping via `stamp()`.
 * - The streaming sub-protocol: sentence-gated stage cascades, explicit
 *   hold/final/disabled modes, and final constraint reporting.
 *
 * Adapter dialects must contain zero safety policy: construct a session,
 * call `guardInput()` before the first provider call, call
 * `finalizeOutput()` with a regenerate closure after structural validation,
 * and `stamp()` the trace meta. Streaming dialects drive `openStream()`.
 *
 * @module
 */

import type { Message } from "../generation/messages";
import type { TraceMeta } from "../generation/types";
import { getHooks } from "../runtime/runtime";
import type { z } from "zod";
import type { BoundaryDef, MediaPartSubject } from "./boundary";
import {
  buildSafetyRegistry,
  type GuardrailBinding,
  type SafetyBinding,
} from "./registry";
import type { SafetyBindingApplicability } from "./applicability";
import { disabledBindingEntries, dormantBindingEntries } from "./binding-audit";
import type { SafetyTuneOptions } from "./tune";
import type {
  Constraint,
  ConstraintAudit,
  ConstraintAuditEntry,
  ConstraintContext,
  ConstraintFailure,
} from "./constraint/types";
import { observeConstraintCheck, runConstraints } from "./constraint/runner";
import type {
  Guardrail,
  GuardrailAudit,
  GuardrailContext,
} from "./guardrail/types";
import { createSafetyStream } from "./stream/engine";
import { guardOutputTextParts as guardCompletionTextParts } from "./output-text-parts";
import { guardInput as guardSafetyInput } from "./input/runner";
import { guardInputOperationMedia } from "./input/operation-media";
import { createScopedSafetySession } from "./scope-session";
import {
  guardInputOperationText,
  type OperationInputTextSlot,
} from "./input/operation-text";
import type { MediaGroupDependency } from "./media/groups";
import type { MediaVisitGroup, MediaVisitItem } from "./media/visit";
import type { SafetyAudit } from "./audit";
import {
  guardOutputMedia as guardSafetyOutputMedia,
  type MediaOutputResult,
} from "./output/media";
import { guardOutputOperationText } from "./output/operation-text";
import { runOneShotConstraints } from "./output/one-shot";
import {
  assertStructuredStepRewrite,
  guardLanguageStepWithEdits,
} from "./output/step";
import { finalizeLanguageTerminal } from "./output/terminal";
import { guardStreamCompletionContent } from "./output/completion";
import type { ResultStepFacts } from "../adapter/result-accumulator";
import type { AssistantContentPart } from "../types/content";
import type {
  ExecutorModelStep,
  StepContentEdit,
  StepTransformer,
} from "../adapter/executor-types";

const outputMediaGuard: unique symbol = Symbol("crux.safety.outputMediaGuard");
const inputOperationMediaGuard: unique symbol = Symbol(
  "crux.safety.inputOperationMediaGuard",
);
const inputOperationTextGuard: unique symbol = Symbol(
  "crux.safety.inputOperationTextGuard",
);
const outputOperationTextGuard: unique symbol = Symbol(
  "crux.safety.outputOperationTextGuard",
);
const oneShotOutputConstraints: unique symbol = Symbol(
  "crux.safety.oneShotOutputConstraints",
);
const languageStepGuardEnabled: unique symbol = Symbol(
  "crux.safety.languageStepGuardEnabled",
);
const languageStepGuard: unique symbol = Symbol(
  "crux.safety.languageStepGuard",
);
const languageStepTransform: unique symbol = Symbol(
  "crux.safety.languageStepTransform",
);
const languageTerminalFinalize: unique symbol = Symbol(
  "crux.safety.languageTerminalFinalize",
);
const streamCompletionGuard: unique symbol = Symbol(
  "crux.safety.streamCompletionGuard",
);

// ─────────────────────────────────────────────────────────────────
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

interface SafetySession extends Safety {
  readonly [languageStepGuardEnabled]: boolean;
  [languageStepGuard](
    stepIndex: number,
    facts: ResultStepFacts,
    schema?: z.ZodType,
  ): Promise<ResultStepFacts>;
  [languageStepTransform](
    step: ExecutorModelStep,
    schema?: z.ZodType,
  ): Promise<readonly StepContentEdit[]>;
  [languageTerminalFinalize](
    output: SafetyOutput,
    regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
    opts?: {
      readonly suspended?: boolean;
      readonly messages?: readonly Message[];
      readonly schema?: z.ZodType;
    },
  ): Promise<SafetyOutput>;
  [streamCompletionGuard](
    content: readonly AssistantContentPart[],
    liveText?: string,
    representedText?: string,
  ): Promise<readonly AssistantContentPart[]>;
  [inputOperationTextGuard](
    slots: readonly OperationInputTextSlot[],
    context?: OperationInputGuardContext,
  ): Promise<readonly OperationInputTextSlot[]>;
  [inputOperationMediaGuard](
    items: readonly MediaVisitItem[],
    groups: readonly MediaVisitGroup[],
    dependencies?: readonly MediaGroupDependency[],
  ): Promise<MediaOutputResult>;
  [outputMediaGuard](
    subjects: readonly MediaPartSubject[],
    options?: {
      readonly minimumRetained?: number;
      readonly model?: string;
    },
  ): Promise<MediaOutputResult>;
  [outputOperationTextGuard](text: string, model?: string): Promise<string>;
  [oneShotOutputConstraints](text: string, model?: string): Promise<void>;
}

/** @internal Whether this session has an applicable per-step output guard. */
export function safetyRequiresLanguageStepTransform(safety: Safety): boolean {
  return (safety as SafetySession)[languageStepGuardEnabled];
}

/** @internal Guard one canonical language step before continuation. */
export function guardSafetySessionLanguageStep(
  safety: Safety,
  stepIndex: number,
  facts: ResultStepFacts,
  schema?: z.ZodType,
): Promise<ResultStepFacts> {
  return (safety as SafetySession)[languageStepGuard](stepIndex, facts, schema);
}

/** @internal Create the Core-owned pre-client-tool transformer when applicable. */
export function createSafetyLanguageStepTransformer(
  safety: Safety,
  schema?: z.ZodType,
): StepTransformer | undefined {
  if (!safetyRequiresLanguageStepTransform(safety)) return undefined;
  const session = safety as SafetySession;
  return Object.freeze({
    transform: (step: ExecutorModelStep) =>
      session[languageStepTransform](step, schema),
  });
}

/** @internal Finalize an already step-guarded language terminal candidate. */
export function finalizeSafetySessionLanguageOutput(
  safety: Safety,
  output: SafetyOutput,
  regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
  opts?: {
    readonly suspended?: boolean;
    readonly messages?: readonly Message[];
    readonly schema?: z.ZodType;
  },
): Promise<SafetyOutput> {
  return (safety as SafetySession)[languageTerminalFinalize](
    output,
    regenerate,
    opts,
  );
}

/** @internal Guard canonical content buffered behind a live text stream. */
export function guardSafetySessionStreamCompletion(
  safety: Safety,
  content: readonly AssistantContentPart[],
  liveText?: string,
  representedText?: string,
): Promise<readonly AssistantContentPart[]> {
  return (safety as SafetySession)[streamCompletionGuard](
    content,
    liveText,
    representedText,
  );
}

interface OperationInputGuardContext {
  readonly model?: string;
  readonly systemPrompt?: string;
}

/** @internal Guard canonical completed-operation input text slots. */
export function guardSafetySessionInputOperationText(
  safety: Safety,
  slots: readonly OperationInputTextSlot[],
  context?: OperationInputGuardContext,
): Promise<readonly OperationInputTextSlot[]> {
  return (safety as SafetySession)[inputOperationTextGuard](slots, context);
}

/** @internal Guard canonical completed-operation input media. */
export function guardSafetySessionInputOperationMedia(
  safety: Safety,
  items: readonly MediaVisitItem[],
  groups: readonly MediaVisitGroup[],
  dependencies?: readonly MediaGroupDependency[],
): Promise<MediaOutputResult> {
  return (safety as SafetySession)[inputOperationMediaGuard](
    items,
    groups,
    dependencies,
  );
}

/** @internal Guard canonical output media for Core-owned adapter projections. */
export function guardSafetySessionOutputMedia(
  safety: Safety,
  subjects: readonly MediaPartSubject[],
  options?: {
    readonly minimumRetained?: number;
    /** Selected provider model for routed completed-operation output. */
    readonly model?: string;
  },
): Promise<MediaOutputResult> {
  return (safety as SafetySession)[outputMediaGuard](subjects, options);
}

/** @internal Guard canonical completed-operation output text. */
export function guardSafetySessionOutputOperationText(
  safety: Safety,
  text: string,
  model?: string,
): Promise<string> {
  return (safety as SafetySession)[outputOperationTextGuard](text, model);
}

/** @internal Evaluate completed-operation terminal constraints exactly once. */
export function runSafetySessionOneShotOutputConstraints(
  safety: Safety,
  text: string,
  model?: string,
): Promise<void> {
  return (safety as SafetySession)[oneShotOutputConstraints](text, model);
}

// ─────────────────────────────────────────────────────────────────
// Default corrective-feedback formatter
// ─────────────────────────────────────────────────────────────────

/**
 * The stock English corrective-message formatter — the exact phrasing
 * constraints have been tuned against. Wrap or replace it via
 * `SafetyCallOptions.formatter` for localization or structured feedback.
 */
export const defaultConstraintFeedbackFormatter: ConstraintFeedbackFormatter = {
  format(failures: readonly ConstraintFailure[]): string {
    const combined = failures
      .map((f) => (f.feedback ? `[${f.name}]: ${f.feedback}` : ""))
      .filter(Boolean)
      .join("\n");
    return [
      "Your previous output did not satisfy the following quality constraints. Please fix all issues in your next response.",
      "",
      combined,
    ].join("\n");
  },
};

/** Keep declaration order while collapsing repeated object references. */
function uniquePolicies<TPolicy extends object>(
  policies: readonly TPolicy[],
): TPolicy[] {
  const seen = new Set<TPolicy>();
  const unique: TPolicy[] = [];
  for (const policy of policies) {
    if (seen.has(policy)) continue;
    seen.add(policy);
    unique.push(policy);
  }
  return unique;
}

function enabledGuardrailBindings(
  bindings: readonly SafetyBinding[],
): GuardrailBinding[] {
  return bindings.filter(
    (binding): binding is GuardrailBinding =>
      binding.kind === "guardrail" &&
      binding.enabled &&
      binding.dormantReason === undefined,
  );
}

function constraintsForMode(
  bindings: readonly SafetyBinding[],
  mode: "enforce" | "report",
): Constraint[] {
  return uniquePolicies(
    bindings
      .filter(
        (binding) =>
          binding.kind === "constraint" &&
          binding.enabled &&
          binding.mode === mode &&
          binding.dormantReason === undefined,
      )
      .map((binding) => binding.policy as Constraint),
  );
}

// ─────────────────────────────────────────────────────────────────
// createSafety
// ─────────────────────────────────────────────────────────────────

/**
 * Create the per-call safety session.
 *
 * Reads runtime globals once at creation and
 * snapshots them, so a mid-call `setHooks()` cannot half-instrument a
 * run.
 *
 * @example
 * ```ts
 * const safety = createSafety({
 *   call: opts, resolved,
 *   promptId: prompt.id, model: opts.model,
 *   systemPrompt: resolved.system, traceId,
 * })
 *
 * ;({ messages } = await safety.guardInput({ messages }))
 *
 * const final = await safety.finalizeOutput(
 *   { text: validText, parsed },
 *   async (corrective) => {
 *     // The ONLY dialect-specific code: how to re-call the model.
 *     messages = [...appendRound(messages), ...corrective]
 *     const regen = await callModelAgain(messages)
 *     return revalidate(regen)
 *   },
 *   { suspended: finishReason === 'tool_approval_required' },
 * )
 *
 * const meta = safety.stamp({ usage, finishReason })
 * ```
 */
export function createSafety(options: SafetyCallOptions): Safety {
  return createSafetySession(options);
}

/** @internal Create a Safety session with primitive-owned exact-binding applicability. */
export function createSafetyWithBindingApplicability(
  options: SafetyCallOptions,
  applicability: SafetyBindingApplicability,
): Safety {
  return createSafetySession(options, applicability);
}

function createSafetySession(
  options: SafetyCallOptions,
  applicability?: SafetyBindingApplicability,
): Safety {
  // Snapshot runtime state once — a mid-call setHooks() cannot
  // half-instrument this run.
  const runtime = getHooks();

  const registry = buildSafetyRegistry({
    global: {
      constraints: runtime.globalConstraints,
      guardrails: runtime.globalGuardrails,
    },
    prompt: {
      constraints: options.resolved?.constraints,
      guardrails: options.resolved?.guardrails,
    },
    call: {
      constraints: options.call?.constraints,
      guardrails: options.call?.guardrails,
    },
    tune: options.safety,
    applicability,
  });

  const constraints = constraintsForMode(registry.bindings, "enforce");
  const reportConstraints = constraintsForMode(registry.bindings, "report");
  const guardrailBindings = enabledGuardrailBindings(registry.bindings);
  const disabledGuardEntries = disabledBindingEntries(registry.bindings);
  const dormantGuardEntries = dormantBindingEntries(registry.bindings);

  // Phase dispatch is keyed, not branched — the phase vocabulary can grow
  // (tool-args, tool-result, context-inject) without session surgery.
  const bindingsByPhase = new Map<"input" | "output", GuardrailBinding[]>();
  for (const binding of guardrailBindings) {
    const phase = boundaryPhase(binding.boundary);
    const list = bindingsByPhase.get(phase) ?? [];
    list.push(binding);
    bindingsByPhase.set(phase, list);
  }
  const phaseBindings = (
    phase: "input" | "output",
  ): readonly GuardrailBinding[] => bindingsByPhase.get(phase) ?? [];

  const enabled =
    constraints.length > 0 ||
    reportConstraints.length > 0 ||
    guardrailBindings.length > 0 ||
    disabledGuardEntries.length > 0 ||
    dormantGuardEntries.length > 0;
  const formatter = options.formatter ?? defaultConstraintFeedbackFormatter;
  const metadata = options.resolved?.metadata ?? {};
  const traceId = options.traceId;

  const transcript: SafetyProtocolEvent[] = [];
  let guardrailAudit: GuardrailAudit | undefined;
  let constraintAudit: ConstraintAudit | undefined;
  let lastMessages: readonly Message[] = [];

  const guardContext = (
    _phase: "input" | "output",
    messages: readonly Message[],
    override?: OperationInputGuardContext,
  ): GuardrailContext => ({
    promptId: options.promptId,
    model: override ? override.model : options.model,
    messages,
    systemPrompt: override ? override.systemPrompt : options.systemPrompt,
    traceId,
    metadata,
  });

  const constraintContext = (): ConstraintContext => ({
    promptId: options.promptId,
    model: options.model,
    traceId,
    attempt: 0,
    metadata,
  });

  const formatterContext = (): SafetyContext => ({
    promptId: options.promptId,
    model: options.model,
    traceId,
    metadata,
  });

  const appendGuardrailAudit = (audit: GuardrailAudit): void => {
    guardrailAudit = {
      applied: [...(guardrailAudit?.applied ?? []), ...audit.applied],
      blocked: guardrailAudit?.blocked === true || audit.blocked,
    };
  };

  if (disabledGuardEntries.length > 0) {
    appendGuardrailAudit({ applied: disabledGuardEntries, blocked: false });
  }
  if (dormantGuardEntries.length > 0) {
    appendGuardrailAudit({ applied: dormantGuardEntries, blocked: false });
  }

  const toCorrectiveMessages = (
    formatted: string | readonly Message[],
  ): readonly Message[] =>
    typeof formatted === "string"
      ? [{ role: "user", content: formatted }]
      : formatted;

  // ── Output-phase internals ─────────────────────────────────────

  async function applyConstraints(
    output: SafetyOutput,
    regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
    guardCandidate: (candidate: SafetyOutput) => Promise<SafetyOutput>,
  ): Promise<SafetyOutput> {
    let rounds = 0;
    const result = await runConstraints(
      constraints,
      { text: output.text, parsed: output.parsed },
      constraintContext(),
      async (_feedback, failures) => {
        const corrective = toCorrectiveMessages(
          formatter.format(failures, formatterContext()),
        );
        const next = await regenerate(corrective);
        const guarded = await guardCandidate({
          text: next.text,
          parsed: next.parsed,
        });
        return { text: guarded.text, parsed: guarded.parsed };
      },
      {
        constraintMaxRetries: options.call?.constraintMaxRetries,
        onCheck: (_constraint, entry) => {},
        onRetry: (failed, attempt, feedbacks) => {
          rounds = attempt;
          transcript.push({ t: "constraint.round", attempt, verdict: "retry" });
        },
        onViolation: (failed, totalAttempts) => {},
      },
    );
    constraintAudit = result.audit;
    transcript.push({
      t: "constraint.round",
      attempt: rounds,
      verdict: "accept",
    });
    return { text: result.output.text, parsed: result.output.parsed };
  }

  async function applyReportConstraints(output: SafetyOutput): Promise<void> {
    if (reportConstraints.length === 0) return;

    const checks = await Promise.all(
      reportConstraints.map(async (constraint) =>
        observeConstraintCheck(
          constraint,
          { text: output.text, parsed: output.parsed },
          constraintContext(),
        ),
      ),
    );
    const entries: ConstraintAuditEntry[] = checks.map((check) => ({
      constraint: check.constraint.id,
      ...(check.constraint.category !== undefined
        ? { category: check.constraint.category }
        : {}),
      severity: check.constraint.severity,
      pass: check.result.pass,
      feedback: check.result.pass ? undefined : check.result.feedback,
      attempts: 1,
      durationMs: check.durationMs,
      metadata: check.result.metadata,
    }));
    const prior = constraintAudit;
    const hasSuggestFailures = entries.some(
      (entry) => !entry.pass && entry.severity === "suggest",
    );
    const hasAssertFailures = entries.some(
      (entry) => !entry.pass && entry.severity === "assert",
    );
    constraintAudit = {
      entries: [...(prior?.entries ?? []), ...entries],
      allPassed:
        (prior?.allPassed ?? true) && entries.every((entry) => entry.pass),
      suggestFallback:
        prior?.suggestFallback === true ||
        (hasSuggestFailures && !hasAssertFailures),
    };
  }

  async function finalizeLanguageOutput(
    output: SafetyOutput,
    regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
    opts:
      | {
          readonly suspended?: boolean;
          readonly messages?: readonly Message[];
          readonly schema?: z.ZodType;
        }
      | undefined,
    terminalOnly: boolean,
  ): Promise<SafetyOutput> {
    if (opts?.messages) lastMessages = opts.messages;
    return finalizeLanguageTerminal({
      output,
      regenerate,
      bindings: phaseBindings("output"),
      terminalOnly,
      enabled,
      suspended: opts?.suspended,
      messages: lastMessages,
      schema: opts?.schema,
      context: guardContext("output", lastMessages),
      appendAudit: appendGuardrailAudit,
      transcript,
      constraintsEnabled: constraints.length > 0,
      applyConstraints,
      applyReportConstraints,
    });
  }

  // ── Streaming sub-protocol ─────────────────────────────────────

  function openStream(): SafetyStream {
    return createSafetyStream({
      outputBindings: phaseBindings("output"),
      constraints: [...constraints, ...reportConstraints],
      messages: () => lastMessages,
      guardContext: () => guardContext("output", lastMessages),
      constraintContext,
      appendGuardrailAudit,
      getConstraintAudit: () => constraintAudit,
      setConstraintAudit: (audit) => {
        constraintAudit = audit;
      },
      transcript,
    });
  }

  // ── The session ────────────────────────────────────────────────

  const session: SafetySession = {
    enabled,
    [languageStepGuardEnabled]: phaseBindings("output").some(
      (binding) =>
        binding.boundary.id === "model.output.text" ||
        binding.boundary.id === "model.output.media",
    ),

    async [languageStepGuard](stepIndex, facts, schema) {
      const result = await guardLanguageStepWithEdits({
        stepIndex,
        facts,
        bindings: phaseBindings("output"),
        context: guardContext("output", lastMessages),
        appendAudit: appendGuardrailAudit,
        transcript,
      });
      assertStructuredStepRewrite({
        original: facts,
        guarded: result.facts,
        schema,
        policyId: result.rewritePolicyId,
      });
      return result.facts;
    },

    async [languageStepTransform](step, schema) {
      const original: ResultStepFacts = {
        content: step.content,
        finishReason: undefined,
        responseId: undefined,
        modelId: undefined,
      };
      const result = await guardLanguageStepWithEdits({
        stepIndex: step.index,
        facts: original,
        bindings: phaseBindings("output"),
        context: guardContext("output", lastMessages),
        appendAudit: appendGuardrailAudit,
        transcript,
      });
      assertStructuredStepRewrite({
        original,
        guarded: result.facts,
        schema,
        policyId: result.rewritePolicyId,
      });
      return result.edits;
    },

    async [languageTerminalFinalize](output, regenerate, opts) {
      return finalizeLanguageOutput(output, regenerate, opts, true);
    },

    async [streamCompletionGuard](content, liveText, representedText) {
      return guardStreamCompletionContent({
        content,
        liveText,
        representedText,
        bindings: phaseBindings("output"),
        context: guardContext("output", lastMessages),
        appendAudit: appendGuardrailAudit,
        transcript,
      });
    },

    async guardInput(input) {
      const inputBindings = phaseBindings("input");
      lastMessages = input.messages;
      const result = await guardSafetyInput({
        bindings: inputBindings,
        input,
        context: (messages) => guardContext("input", messages),
        appendAudit: appendGuardrailAudit,
        transcript,
      });
      lastMessages = result.messages;
      return result;
    },

    async finalizeOutput(output, regenerate, opts) {
      return finalizeLanguageOutput(output, regenerate, opts, false);
    },

    async guardOutputTextParts(parts) {
      return guardCompletionTextParts({
        bindings: phaseBindings("output"),
        parts,
        context: guardContext("output", lastMessages),
        appendAudit: appendGuardrailAudit,
        transcript,
      });
    },

    async [inputOperationTextGuard](slots, context) {
      return guardInputOperationText({
        bindings: phaseBindings("input"),
        slots,
        context: guardContext("input", lastMessages, context),
        appendAudit: appendGuardrailAudit,
      });
    },

    async [inputOperationMediaGuard](items, groups, dependencies) {
      return guardInputOperationMedia({
        bindings: phaseBindings("input").filter(
          (binding) => binding.boundary.id === "user.input.media",
        ),
        items,
        groups,
        dependencies,
        context: guardContext("input", lastMessages),
        appendAudit: appendGuardrailAudit,
      });
    },

    async [outputMediaGuard](subjects, mediaOptions) {
      return guardSafetyOutputMedia({
        bindings: phaseBindings("output").filter(
          (binding) => binding.boundary.id === "model.output.media",
        ),
        subjects,
        minimumRetained: mediaOptions?.minimumRetained ?? 0,
        context: {
          ...guardContext("output", lastMessages),
          model: mediaOptions?.model ?? options.model,
        },
        appendAudit: appendGuardrailAudit,
      });
    },

    async [outputOperationTextGuard](text, model) {
      return guardOutputOperationText({
        bindings: phaseBindings("output"),
        text,
        context: {
          ...guardContext("output", lastMessages),
          model: model ?? options.model,
        },
        appendAudit: appendGuardrailAudit,
      });
    },

    async [oneShotOutputConstraints](text, model) {
      const audit = await runOneShotConstraints({
        constraints: constraints.filter(
          (constraint) => constraint.on.id === "model.output.text",
        ),
        reportConstraints: reportConstraints.filter(
          (constraint) => constraint.on.id === "model.output.text",
        ),
        text,
        context: {
          ...constraintContext(),
          model: model ?? options.model,
        },
      });
      if (audit) constraintAudit = audit;
    },

    get audit() {
      return {
        ...(guardrailAudit ? { guardrails: guardrailAudit } : {}),
        ...(constraintAudit ? { constraints: constraintAudit } : {}),
      };
    },

    stamp(meta) {
      if (!enabled) return meta;
      transcript.push({ t: "stamp" });
      return {
        ...meta,
        ...(guardrailAudit &&
        (guardrailAudit.applied.length > 0 || guardrailAudit.blocked)
          ? { guardrails: guardrailAudit }
          : {}),
        ...(constraintAudit && constraintAudit.entries.length > 0
          ? { constraints: constraintAudit }
          : {}),
      };
    },

    openStream,

    transcript,
  };
  return createScopedSafetySession(options.promptId, session) as SafetySession;
}

function boundaryPhase(boundary: BoundaryDef): "input" | "output" {
  return isInputBoundary(boundary) ? "input" : "output";
}

function isInputBoundary(boundary: BoundaryDef): boolean {
  return (
    boundary.id === "user.input" ||
    boundary.id === "user.input.media" ||
    boundary.id === "model.input"
  );
}
