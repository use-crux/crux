/**
 * The per-call `Safety` session — the single consumption entry point for
 * guardrails and constraints.
 *
 * Authoring stays with `guardrail()` and `constraint()`. Execution goes
 * through one session per `generate()`/`stream()` call, created with
 * {@link createSafety}. The session owns everything the adapter dialects
 * used to coordinate by hand:
 *
 * - Three-scope policy merge (per-call > per-prompt > global) including
 *   reading runtime globals — callers never touch the registry.
 * - Phase splitting and guarded-content selection (last user message with
 *   prompt-text fallback), including redaction write-back.
 * - The constraint retry state machine and corrective-message phrasing
 *   (injectable via {@link ConstraintFeedbackFormatter}).
 * - Suspension policy: output safety is skipped on tool-approval suspension.
 * - Instrumentation hook fan-out and all safety observability emission.
 * - Audit accumulation across phases and `TraceMeta` shaping via `stamp()`.
 * - The streaming sub-protocol ("LLM Suspense"): per-chunk guard evaluation
 *   with hold buffers, mid-stream transforms, and flush-time validation.
 *
 * Adapter dialects must contain zero safety policy: construct a session,
 * call `guardInput()` before the first provider call, call
 * `finalizeOutput()` with a regenerate closure after structural validation,
 * and `stamp()` the trace meta. Streaming dialects drive `openStream()`.
 *
 * @module
 */

import type { Message } from '../messages'
import type { TraceMeta } from '../types'
import { getRuntime } from '../runtime'
import type {
  Constraint,
  ConstraintAudit,
  ConstraintAuditEntry,
  ConstraintContext,
  ConstraintFailure,
} from './constraint/types'
import { runConstraints, observeConstraintCheck } from './constraint/runner'
import { ConstraintViolationError } from './constraint/errors'
import type {
  ChunkGuardrailResult,
  Guardrail,
  GuardrailAudit,
  GuardrailAuditEntry,
  GuardrailContext,
  GuardrailPhase,
} from './guardrail/types'
import { createGuardrailPipeline } from './guardrail/pipeline'
import { GuardrailBlockedError } from './guardrail/errors'

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/** Options for {@link createSafety} — one session per generate/stream call. */
export interface SafetyCallOptions {
  /** Per-call overrides (highest precedence). Rarely used; usually omitted. */
  readonly call?: {
    readonly constraints?: readonly Constraint[]
    readonly guardrails?: readonly Guardrail[]
    /** Shared cap on total constraint retries across all constraints. */
    readonly constraintMaxRetries?: number
  }
  /** The resolved prompt — the session reads constraints/guardrails/metadata itself. */
  readonly resolved?: {
    readonly constraints?: readonly Constraint[]
    readonly guardrails?: readonly Guardrail[]
    readonly metadata?: Readonly<Record<string, unknown>>
  }
  /** Identity threaded into spans, audits, and hook payloads. */
  readonly promptId: string | undefined
  readonly model: string | undefined
  readonly traceId?: string
  readonly systemPrompt?: string
  /**
   * Injectable corrective-message formatting (localization, structured
   * feedback). The default reproduces the stock English phrasing
   * byte-for-byte.
   */
  readonly formatter?: ConstraintFeedbackFormatter
  // Global scope (runtime globals) is read internally — callers never touch the registry.
}

/** The output under safety evaluation: final text plus the parsed object for structured prompts. */
export interface SafetyOutput {
  readonly text: string
  readonly parsed?: unknown
}

/** Call-identity context handed to {@link ConstraintFeedbackFormatter}. */
export interface SafetyContext {
  readonly promptId: string | undefined
  readonly model: string | undefined
  readonly traceId: string | undefined
  readonly metadata: Readonly<Record<string, unknown>>
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
  format(failures: readonly ConstraintFailure[], ctx: SafetyContext): string | readonly Message[]
}

/**
 * Machine-readable protocol trace for the dialect parity suite: both
 * dialects must produce identical event sequences for the same inputs.
 */
export type SafetyProtocolEvent =
  | { readonly t: 'input.guard'; readonly guards: number; readonly actions: readonly string[] }
  | { readonly t: 'constraint.round'; readonly attempt: number; readonly verdict: 'retry' | 'accept' }
  | { readonly t: 'suspend' }
  | { readonly t: 'output.guard'; readonly guards: number; readonly actions: readonly string[] }
  | { readonly t: 'stream.chunk'; readonly directive: 'emit' | 'hold' }
  | { readonly t: 'stream.finish' }
  | { readonly t: 'stamp' }

/** Verdict for one fed stream chunk. */
export type SafetyStreamDirective = { readonly kind: 'emit'; readonly content: string } | { readonly kind: 'hold' }

/**
 * Final seal of a guarded stream. `text` is the complete guarded output
 * (for audits and memory); `pending` is the tail not yet released through
 * `feed()` — the dialect must forward it to the consumer before closing.
 */
export interface SafetyStreamSeal extends SafetyOutput {
  readonly pending: string
}

/**
 * Streaming sub-protocol ("LLM Suspense"): per-chunk guard evaluation with
 * hold buffers and mid-stream transforms. Owns `buffer: 'none'` vs `'full'`
 * routing, held-content accumulation/release, and flush-time validation.
 * Constraints run report-only at `finish()` — a live stream cannot
 * regenerate. Constraint `onChunk` may abort a stream that is going wrong.
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
  feed(chunk: string): Promise<SafetyStreamDirective>

  /**
   * End of stream: release held content, run `buffer: 'full'` guards on the
   * accumulated text, run constraints report-only, return the final seal.
   */
  finish(): Promise<SafetyStreamSeal>

  /** Convenience pipe-through for TransformStream-based dialects. */
  transform(): TransformStream<string, string>
}

/**
 * A per-call safety session. Create with {@link createSafety}; drive
 * `guardInput()` → `finalizeOutput()` → `stamp()` (or `openStream()` for
 * streamed runs).
 */
export interface Safety {
  /** False when nothing applies — all methods become no-op passthroughs. */
  readonly enabled: boolean

  /**
   * Input phase. Owns last-user-message extraction (with prompt-text
   * fallback) and writes redacted/transformed content back into the
   * returned messages (or prompt). Throws {@link GuardrailBlockedError} on
   * block.
   */
  guardInput(input: {
    readonly messages: readonly Message[]
    readonly prompt?: string
  }): Promise<{ readonly messages: readonly Message[]; readonly prompt?: string }>

  /**
   * Output phase, fixed order: constraints (parallel check,
   * combined-feedback retries via `regenerate`) then output guardrails on
   * the surviving text. `suspended: true` (tool-approval) skips output
   * safety — that policy is owned here, not by dialects. Throws
   * {@link ConstraintViolationError} / {@link GuardrailBlockedError}.
   *
   * `regenerate` is the only dialect-specific concern: append the
   * corrective messages to the conversation, re-call the model, re-run
   * structural validation, and return the new output.
   */
  finalizeOutput(
    output: SafetyOutput,
    regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
    opts?: { readonly suspended?: boolean; readonly messages?: readonly Message[] },
  ): Promise<SafetyOutput>

  /** Audits accumulated so far (exact `GuardrailAudit` / `ConstraintAudit` shapes). */
  readonly audit: { readonly guardrails?: GuardrailAudit; readonly constraints?: ConstraintAudit }

  /** Return `meta` with audit fields attached iff non-empty. */
  stamp<TMeta extends TraceMeta>(meta: TMeta): TMeta

  /** Open the streaming sub-protocol for one streamed response. */
  openStream(): SafetyStream

  /** Protocol transcript — see {@link SafetyProtocolEvent}. */
  readonly transcript: readonly SafetyProtocolEvent[]
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
      .map((f) => (f.feedback ? `[${f.name}]: ${f.feedback}` : ''))
      .filter(Boolean)
      .join('\n')
    return [
      'Your previous output did not satisfy the following quality constraints. Please fix all issues in your next response.',
      '',
      combined,
    ].join('\n')
  },
}

// ─────────────────────────────────────────────────────────────────
// Internal: merged policy bindings
// ─────────────────────────────────────────────────────────────────

/**
 * One merged policy binding. `mode` is reserved for attachment-time
 * enforcement control (`'report'` shadow rollouts); v1 always binds
 * `'enforce'`, but the merge produces bindings so adding the knob later
 * does not require re-plumbing precedence.
 */
interface SafetyBinding<TPolicy> {
  readonly policy: TPolicy
  readonly mode: 'enforce'
}

/**
 * Union merge with name-keyed precedence: per-call wins over per-prompt
 * wins over global. Lets a call site soften or replace a globally
 * configured policy without touching global config.
 */
function mergeScopes<TPolicy extends { readonly name: string }>(
  perCall: readonly TPolicy[] | undefined,
  perPrompt: readonly TPolicy[] | undefined,
  global: readonly TPolicy[] | undefined,
): SafetyBinding<TPolicy>[] {
  const seen = new Map<string, SafetyBinding<TPolicy>>()
  for (const policy of global ?? []) seen.set(policy.name, { policy, mode: 'enforce' })
  for (const policy of perPrompt ?? []) seen.set(policy.name, { policy, mode: 'enforce' })
  for (const policy of perCall ?? []) seen.set(policy.name, { policy, mode: 'enforce' })
  return [...seen.values()]
}

// ─────────────────────────────────────────────────────────────────
// createSafety
// ─────────────────────────────────────────────────────────────────

/**
 * Create the per-call safety session.
 *
 * Reads runtime globals and instrumentation hooks once at creation and
 * snapshots them, so a mid-call `setRuntime()` cannot half-instrument a
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
  // Snapshot runtime state once — a mid-call setRuntime() cannot
  // half-instrument this run.
  const runtime = getRuntime()
  const hooks = runtime.instrumentationHooks

  const constraintBindings = mergeScopes(
    options.call?.constraints,
    options.resolved?.constraints,
    runtime.globalConstraints,
  )
  const guardrailBindings = mergeScopes(
    options.call?.guardrails,
    options.resolved?.guardrails,
    runtime.globalGuardrails,
  )

  const constraints = constraintBindings.map((b) => b.policy)
  const guardrails = guardrailBindings.map((b) => b.policy)

  // Phase dispatch is keyed, not branched — the phase vocabulary can grow
  // (tool-args, tool-result, context-inject) without session surgery.
  const guardsByPhase = new Map<GuardrailPhase, Guardrail[]>()
  for (const guard of guardrails) {
    const list = guardsByPhase.get(guard.phase) ?? []
    list.push(guard)
    guardsByPhase.set(guard.phase, list)
  }
  const phaseGuards = (phase: GuardrailPhase): readonly Guardrail[] => guardsByPhase.get(phase) ?? []

  const enabled = constraints.length > 0 || guardrails.length > 0
  const formatter = options.formatter ?? defaultConstraintFeedbackFormatter
  const metadata = options.resolved?.metadata ?? {}
  const traceId = options.traceId

  const transcript: SafetyProtocolEvent[] = []
  let guardrailAudit: GuardrailAudit | undefined
  let constraintAudit: ConstraintAudit | undefined
  let lastMessages: readonly Message[] = []

  const guardContext = (phase: GuardrailPhase, messages: readonly Message[]): GuardrailContext => ({
    phase,
    promptId: options.promptId,
    model: options.model,
    messages,
    systemPrompt: options.systemPrompt,
    traceId,
    metadata,
  })

  const constraintContext = (): ConstraintContext => ({
    promptId: options.promptId,
    model: options.model,
    traceId,
    attempt: 0,
    metadata,
  })

  const formatterContext = (): SafetyContext => ({
    promptId: options.promptId,
    model: options.model,
    traceId,
    metadata,
  })

  const appendGuardrailAudit = (audit: GuardrailAudit): void => {
    guardrailAudit = {
      applied: [...(guardrailAudit?.applied ?? []), ...audit.applied],
      blocked: guardrailAudit?.blocked === true || audit.blocked,
    }
  }

  const emitGuardrailHooks = (audit: GuardrailAudit): void => {
    if (!hooks?.onGuardrailRun) return
    for (const entry of audit.applied) {
      hooks.onGuardrailRun({
        guardrailId: entry.guard,
        phase: entry.phase,
        action: entry.action as 'pass' | 'block' | 'redact' | 'transform' | 'warn',
        durationMs: entry.durationMs,
        traceId,
      })
    }
  }

  const toCorrectiveMessages = (formatted: string | readonly Message[]): readonly Message[] =>
    typeof formatted === 'string' ? [{ role: 'user', content: formatted }] : formatted

  // ── Output-phase internals ─────────────────────────────────────

  async function applyConstraints(
    output: SafetyOutput,
    regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
  ): Promise<SafetyOutput> {
    let rounds = 0
    const result = await runConstraints(
      constraints,
      { text: output.text, parsed: output.parsed },
      constraintContext(),
      async (_feedback, failures) => {
        const corrective = toCorrectiveMessages(formatter.format(failures, formatterContext()))
        const next = await regenerate(corrective)
        return { text: next.text, parsed: next.parsed }
      },
      {
        constraintMaxRetries: options.call?.constraintMaxRetries,
        onCheck: (_constraint, entry) => {
          hooks?.onConstraintCheck?.({
            constraintName: entry.constraint,
            severity: entry.severity,
            pass: entry.pass,
            feedback: entry.feedback,
            durationMs: entry.durationMs,
            attempt: entry.attempts,
            traceId,
          })
        },
        onRetry: (failed, attempt, feedbacks) => {
          rounds = attempt
          transcript.push({ t: 'constraint.round', attempt, verdict: 'retry' })
          hooks?.onConstraintRetry?.({
            constraintNames: failed.map((c) => c.name),
            attempt,
            combinedFeedback: feedbacks.join('\n'),
            traceId,
          })
        },
        onViolation: (failed, totalAttempts) => {
          hooks?.onConstraintViolation?.({
            constraintNames: failed.map((c) => c.name),
            totalAttempts,
            traceId,
          })
        },
      },
    )
    constraintAudit = result.audit
    transcript.push({ t: 'constraint.round', attempt: rounds, verdict: 'accept' })
    return { text: result.output.text, parsed: result.output.parsed }
  }

  async function applyOutputGuards(text: string, messages: readonly Message[]): Promise<string> {
    const outputGuards = phaseGuards('output')
    const pipeline = createGuardrailPipeline(outputGuards)
    const result = await pipeline.runOutput(text, guardContext('output', messages))
    appendGuardrailAudit(result.audit)
    emitGuardrailHooks(result.audit)
    transcript.push({
      t: 'output.guard',
      guards: outputGuards.length,
      actions: result.audit.applied.map((entry) => entry.action),
    })
    return result.content
  }

  // ── Streaming sub-protocol ─────────────────────────────────────

  function openStream(): SafetyStream {
    const outputGuards = phaseGuards('output')
    const noneGuards = outputGuards.filter((g) => g.stream?.buffer === 'none' && g.onChunk)
    const fullGuards = outputGuards.filter((g) => g.stream?.buffer === 'full')
    const chunkConstraints = constraints.filter((c) => c.onChunk)
    const streamCtx = (): GuardrailContext => guardContext('output', lastMessages)

    let accumulated = ''
    let emittedLength = 0
    const holdBuffers = new Map<string, string>()

    const recordChunkAction = (guard: Guardrail, result: ChunkGuardrailResult, original: string): void => {
      if (result.action === 'pass' || result.action === 'hold') return
      const entry: GuardrailAuditEntry = {
        guard: guard.name,
        ...(guard.category !== undefined ? { category: guard.category } : {}),
        phase: 'output',
        action: result.action,
        ...(result.action === 'redact' || result.action === 'transform' ? { original } : {}),
        durationMs: 0,
      }
      appendGuardrailAudit({ applied: [entry], blocked: result.action === 'block' })
    }

    async function feed(chunk: string): Promise<SafetyStreamDirective> {
      accumulated += chunk
      let currentChunk = chunk
      let held = false

      for (const guard of noneGuards) {
        // Prepend any held content from this guard's buffer.
        const heldContent = holdBuffers.get(guard.name) ?? ''
        const guardInput = heldContent + currentChunk

        const result: ChunkGuardrailResult = await guard.onChunk!(guardInput, accumulated, streamCtx())

        switch (result.action) {
          case 'pass':
            holdBuffers.delete(guard.name)
            currentChunk = guardInput
            break

          case 'hold':
            holdBuffers.set(guard.name, guardInput)
            held = true
            break

          case 'transform':
          case 'redact':
            holdBuffers.delete(guard.name)
            recordChunkAction(guard, result, guardInput)
            accumulated = accumulated.slice(0, accumulated.length - guardInput.length) + result.content
            currentChunk = result.content
            break

          case 'block':
            holdBuffers.delete(guard.name)
            recordChunkAction(guard, result, guardInput)
            throw new GuardrailBlockedError({
              guardrailId: guard.name,
              phase: 'output',
              reason: result.reason,
            })

          case 'warn':
            holdBuffers.delete(guard.name)
            recordChunkAction(guard, result, guardInput)
            currentChunk = guardInput
            break
        }

        // If any guard held, emit nothing and skip remaining guards.
        if (held) break
      }

      if (held) {
        transcript.push({ t: 'stream.chunk', directive: 'hold' })
        return { kind: 'hold' }
      }

      // Constraint onChunk — report-only with respect to retries, but may
      // abort a stream that is going wrong.
      for (const c of chunkConstraints) {
        const verdict = await c.onChunk!(currentChunk, accumulated, constraintContext())
        if (verdict.abort) {
          throw new ConstraintViolationError({
            failedConstraints: [{ name: c.name, feedback: verdict.feedback }],
            audit: { entries: constraintAudit?.entries ?? [], allPassed: false, suggestFallback: false },
            lastOutput: accumulated,
            totalAttempts: 1,
          })
        }
      }

      // Full-buffer guards validate the complete text at finish() — until
      // then the whole stream is held.
      if (fullGuards.length > 0) {
        transcript.push({ t: 'stream.chunk', directive: 'hold' })
        return { kind: 'hold' }
      }

      emittedLength += currentChunk.length
      transcript.push({ t: 'stream.chunk', directive: 'emit' })
      return { kind: 'emit', content: currentChunk }
    }

    async function finish(): Promise<SafetyStreamSeal> {
      holdBuffers.clear()
      let text = accumulated

      if (fullGuards.length > 0) {
        // Run buffer:'full' guards through the pipeline engine so spans,
        // artifacts, audits, and block semantics match the non-streamed
        // output phase exactly.
        const pipeline = createGuardrailPipeline(fullGuards)
        const result = await pipeline.runOutput(accumulated, streamCtx())
        appendGuardrailAudit(result.audit)
        emitGuardrailHooks(result.audit)
        text = result.content
      }

      // Constraints run report-only — a live stream cannot regenerate.
      if (constraints.length > 0) {
        const checks = await Promise.all(
          constraints.map(async (c) =>
            observeConstraintCheck(c, { text, parsed: undefined }, constraintContext()),
          ),
        )
        const entries: ConstraintAuditEntry[] = checks.map((check) => ({
          constraint: check.constraint.name,
          ...(check.constraint.category !== undefined ? { category: check.constraint.category } : {}),
          severity: check.constraint.severity,
          pass: check.result.pass,
          feedback: check.result.pass ? undefined : check.result.feedback,
          attempts: 1,
          durationMs: check.durationMs,
          metadata: check.result.metadata,
        }))
        const allPassed = entries.every((entry) => entry.pass)
        const hasAssertFailures = entries.some((entry) => !entry.pass && entry.severity === 'assert')
        constraintAudit = {
          entries: [...(constraintAudit?.entries ?? []), ...entries],
          allPassed,
          suggestFallback: !allPassed && !hasAssertFailures,
        }
      }

      transcript.push({ t: 'stream.finish' })

      // With full-buffer guards nothing was released during feed(); without
      // them, only held remnants are pending.
      const pending = fullGuards.length > 0 ? text : accumulated.slice(emittedLength)
      return { text, parsed: undefined, pending }
    }

    function transform(): TransformStream<string, string> {
      return new TransformStream<string, string>({
        async transform(chunk, controller) {
          const directive = await feed(chunk)
          if (directive.kind === 'emit' && directive.content.length > 0) {
            controller.enqueue(directive.content)
          }
        },
        async flush(controller) {
          const seal = await finish()
          if (seal.pending.length > 0) {
            controller.enqueue(seal.pending)
          }
        },
      })
    }

    return { feed, finish, transform }
  }

  // ── The session ────────────────────────────────────────────────

  return {
    enabled,

    async guardInput(input) {
      const inputGuards = phaseGuards('input')
      lastMessages = input.messages
      if (inputGuards.length === 0) return input

      const lastUserMessage = [...input.messages].reverse().find((message) => message.role === 'user')
      const guarded =
        lastUserMessage && typeof lastUserMessage.content === 'string' ? lastUserMessage.content : input.prompt
      if (guarded === undefined) return input

      const pipeline = createGuardrailPipeline(inputGuards)
      const result = await pipeline.runInput(guarded, guardContext('input', input.messages))
      appendGuardrailAudit(result.audit)
      emitGuardrailHooks(result.audit)
      transcript.push({
        t: 'input.guard',
        guards: inputGuards.length,
        actions: result.audit.applied.map((entry) => entry.action),
      })

      if (result.content === guarded) return input

      if (lastUserMessage && typeof lastUserMessage.content === 'string') {
        const messages = input.messages.map((message) =>
          message === lastUserMessage ? { ...message, content: result.content } : message,
        )
        lastMessages = messages
        return { messages, prompt: input.prompt }
      }
      return { messages: input.messages, prompt: result.content }
    },

    async finalizeOutput(output, regenerate, opts) {
      if (opts?.messages) lastMessages = opts.messages
      if (!enabled) return output

      if (opts?.suspended) {
        // Suspension policy, decided once: tool-approval suspension skips
        // output safety — the response is a request for permission, not a
        // final output.
        transcript.push({ t: 'suspend' })
        return output
      }

      let current = output
      if (constraints.length > 0) {
        current = await applyConstraints(current, regenerate)
      }
      if (phaseGuards('output').length > 0) {
        const text = await applyOutputGuards(current.text, lastMessages)
        if (text !== current.text) current = { ...current, text }
      }
      return current
    },

    get audit() {
      return {
        ...(guardrailAudit ? { guardrails: guardrailAudit } : {}),
        ...(constraintAudit ? { constraints: constraintAudit } : {}),
      }
    },

    stamp(meta) {
      if (!enabled) return meta
      transcript.push({ t: 'stamp' })
      return {
        ...meta,
        ...(guardrailAudit && (guardrailAudit.applied.length > 0 || guardrailAudit.blocked)
          ? { guardrails: guardrailAudit }
          : {}),
        ...(constraintAudit && constraintAudit.entries.length > 0 ? { constraints: constraintAudit } : {}),
      }
    },

    openStream,

    transcript,
  }
}
