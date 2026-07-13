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

import type { Message } from '../generation/messages'
import type { MessageContent } from '../types/content'
import type { TraceMeta } from '../generation/types'
import { contentText, messageText } from '../content'
import { getHooks } from '../runtime/runtime'
import type { z } from 'zod'
import type { BoundaryDef } from './boundary'
import { SafetyResultError } from './errors'
import { buildSafetyRegistry, type SafetyBinding } from './registry'
import type { SafetyTuneOptions } from './tune'
import type {
  Constraint,
  ConstraintAudit,
  ConstraintAuditEntry,
  ConstraintContext,
  ConstraintFailure,
} from './constraint/types'
import { observeConstraintCheck, runConstraints } from './constraint/runner'
import type {
  Guardrail,
  GuardrailAudit,
  GuardrailAuditEntry,
  GuardrailContext,
} from './guardrail/types'
import { createGuardrailPipeline } from './guardrail/pipeline'
import { createSafetyStream } from './stream/engine'
import { resyncStructuredText } from './structured'
import { guardOutputTextParts as guardCompletionTextParts } from './output-text-parts'

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
  /**
   * Explicit per-call safety posture overrides keyed by policy id.
   *
   * Tuning can only adjust enforcement/reporting, stream posture, or whether
   * an attached policy is enabled for this call. It never replaces policy
   * logic, boundaries, or identity.
   */
  readonly safety?: SafetyTuneOptions
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
  feed(chunk: string): Promise<SafetyStreamDirective>

  /**
   * End of stream: flush held segments, run final-only guards and
   * report-mode constraints, then return the final seal.
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
   * Input boundary pass.
   *
   * Runs input guardrails over every user message in order. Rewrites are
   * written back into the returned messages before the provider sees them.
   * If no user message exists, the optional prompt fallback is guarded.
   * Throws {@link GuardrailBlockedError} on block.
   */
  guardInput(input: {
    readonly messages: readonly Message[]
    readonly prompt?: string
  }): Promise<{ readonly messages: readonly Message[]; readonly prompt?: string }>

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
    opts?: { readonly suspended?: boolean; readonly messages?: readonly Message[]; readonly schema?: z.ZodType },
  ): Promise<SafetyOutput>

  /**
   * Guard provider-completed text slots independently and in order.
   *
   * This completion-only path runs output guardrails and records their audit,
   * but never evaluates constraints or regenerates. Streaming constraints stay
   * owned by {@link SafetyStream.finish} over the aggregate emitted text.
   *
   * @internal Adapter execution only.
   */
  guardOutputTextParts(parts: readonly string[]): Promise<readonly string[]>

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

/** Keep declaration order while collapsing repeated object references. */
function uniquePolicies<TPolicy extends object>(policies: readonly TPolicy[]): TPolicy[] {
  const seen = new Set<TPolicy>()
  const unique: TPolicy[] = []
  for (const policy of policies) {
    if (seen.has(policy)) continue
    seen.add(policy)
    unique.push(policy)
  }
  return unique
}

function effectiveGuardrails(bindings: readonly SafetyBinding[]): Guardrail[] {
  const seen = new Set<Guardrail>()
  const guards: Guardrail[] = []
  for (const binding of bindings) {
    if (binding.kind !== 'guardrail' || !binding.enabled) continue
    const guard = binding.policy as Guardrail
    if (seen.has(guard)) continue
    seen.add(guard)
    guards.push(effectiveGuardrail(guard, binding))
  }
  return guards
}

function constraintsForMode(bindings: readonly SafetyBinding[], mode: 'enforce' | 'report'): Constraint[] {
  return uniquePolicies(
    bindings
      .filter((binding) => binding.kind === 'constraint' && binding.enabled && binding.mode === mode)
      .map((binding) => binding.policy as Constraint),
  )
}

function effectiveGuardrail(guard: Guardrail, binding: SafetyBinding): Guardrail {
  if (binding.mode === guard.mode && binding.stream === guard.stream) return guard
  return Object.freeze({
    ...guard,
    mode: binding.mode,
    stream: binding.stream,
  })
}

function disabledGuardrailEntries(bindings: readonly SafetyBinding[]): GuardrailAuditEntry[] {
  const seen = new Set<Guardrail>()
  const entries: GuardrailAuditEntry[] = []
  for (const binding of bindings) {
    if (binding.kind !== 'guardrail' || binding.enabled) continue
    const guard = binding.policy as Guardrail
    if (seen.has(guard)) continue
    seen.add(guard)
    entries.push({
      guard: guard.id,
      ...(guard.category !== undefined ? { category: guard.category } : {}),
      phase: guardPhase(guard),
      action: 'allow',
      reason: 'disabled by call site',
      durationMs: 0,
    })
  }
  return entries
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
  // Snapshot runtime state once — a mid-call setHooks() cannot
  // half-instrument this run.
  const runtime = getHooks()

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
  })

  const constraints = constraintsForMode(registry.bindings, 'enforce')
  const reportConstraints = constraintsForMode(registry.bindings, 'report')
  const guardrails = effectiveGuardrails(registry.bindings)
  const disabledGuardEntries = disabledGuardrailEntries(registry.bindings)

  // Phase dispatch is keyed, not branched — the phase vocabulary can grow
  // (tool-args, tool-result, context-inject) without session surgery.
  const guardsByPhase = new Map<'input' | 'output', Guardrail[]>()
  for (const guard of guardrails) {
    const phase = guardPhase(guard)
    const list = guardsByPhase.get(phase) ?? []
    list.push(guard)
    guardsByPhase.set(phase, list)
  }
  const phaseGuards = (phase: 'input' | 'output'): readonly Guardrail[] => guardsByPhase.get(phase) ?? []

  const enabled =
    constraints.length > 0 ||
    reportConstraints.length > 0 ||
    guardrails.length > 0 ||
    disabledGuardEntries.length > 0
  const formatter = options.formatter ?? defaultConstraintFeedbackFormatter
  const metadata = options.resolved?.metadata ?? {}
  const traceId = options.traceId

  const transcript: SafetyProtocolEvent[] = []
  let guardrailAudit: GuardrailAudit | undefined
  let constraintAudit: ConstraintAudit | undefined
  let lastMessages: readonly Message[] = []

  const guardContext = (_phase: 'input' | 'output', messages: readonly Message[]): GuardrailContext => ({
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

  if (disabledGuardEntries.length > 0) {
    appendGuardrailAudit({ applied: disabledGuardEntries, blocked: false })
  }

  const toCorrectiveMessages = (formatted: string | readonly Message[]): readonly Message[] =>
    typeof formatted === 'string' ? [{ role: 'user', content: formatted }] : formatted

  // ── Output-phase internals ─────────────────────────────────────

  async function applyConstraints(
    output: SafetyOutput,
    regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
    guardCandidate: (candidate: SafetyOutput) => Promise<SafetyOutput>,
  ): Promise<SafetyOutput> {
    let rounds = 0
    const result = await runConstraints(
      constraints,
      { text: output.text, parsed: output.parsed },
      constraintContext(),
      async (_feedback, failures) => {
        const corrective = toCorrectiveMessages(formatter.format(failures, formatterContext()))
        const next = await regenerate(corrective)
        const guarded = await guardCandidate({ text: next.text, parsed: next.parsed })
        return { text: guarded.text, parsed: guarded.parsed }
      },
      {
        constraintMaxRetries: options.call?.constraintMaxRetries,
        onCheck: (_constraint, entry) => {
        },
        onRetry: (failed, attempt, feedbacks) => {
          rounds = attempt
          transcript.push({ t: 'constraint.round', attempt, verdict: 'retry' })
        },
        onViolation: (failed, totalAttempts) => {
        },
      },
    )
    constraintAudit = result.audit
    transcript.push({ t: 'constraint.round', attempt: rounds, verdict: 'accept' })
    return { text: result.output.text, parsed: result.output.parsed }
  }

  async function applyReportConstraints(output: SafetyOutput): Promise<void> {
    if (reportConstraints.length === 0) return

    const checks = await Promise.all(
      reportConstraints.map(async (constraint) =>
        observeConstraintCheck(constraint, { text: output.text, parsed: output.parsed }, constraintContext()),
      ),
    )
    const entries: ConstraintAuditEntry[] = checks.map((check) => ({
      constraint: check.constraint.id,
      ...(check.constraint.category !== undefined ? { category: check.constraint.category } : {}),
      severity: check.constraint.severity,
      pass: check.result.pass,
      feedback: check.result.pass ? undefined : check.result.feedback,
      attempts: 1,
      durationMs: check.durationMs,
      metadata: check.result.metadata,
    }))
    const prior = constraintAudit
    const hasSuggestFailures = entries.some((entry) => !entry.pass && entry.severity === 'suggest')
    const hasAssertFailures = entries.some((entry) => !entry.pass && entry.severity === 'assert')
    constraintAudit = {
      entries: [...(prior?.entries ?? []), ...entries],
      allPassed: (prior?.allPassed ?? true) && entries.every((entry) => entry.pass),
      suggestFallback: prior?.suggestFallback === true || (hasSuggestFailures && !hasAssertFailures),
    }
  }

  async function applyOutputGuards(
    output: SafetyOutput,
    messages: readonly Message[],
    schema: z.ZodType | undefined,
  ): Promise<SafetyOutput> {
    const outputGuards = phaseGuards('output')
    const pipeline = createGuardrailPipeline(outputGuards)
    const result = await pipeline.runOutput(output.text, guardContext('output', messages), { parsed: output.parsed })
    appendGuardrailAudit(result.audit)
    transcript.push({
      t: 'output.guard',
      guards: outputGuards.length,
      actions: result.audit.applied.map((entry) => entry.action),
    })
    return resyncStructuredText(output, result.content, {
      schema,
      policyId: latestRewritePolicyId(result.audit.applied),
    })
  }

  // ── Streaming sub-protocol ─────────────────────────────────────

  function openStream(): SafetyStream {
    return createSafetyStream({
      outputGuards: phaseGuards('output'),
      constraints: [...constraints, ...reportConstraints],
      messages: () => lastMessages,
      guardContext: () => guardContext('output', lastMessages),
      constraintContext,
      appendGuardrailAudit,
      getConstraintAudit: () => constraintAudit,
      setConstraintAudit: (audit) => {
        constraintAudit = audit
      },
      transcript,
    })
  }

  // ── The session ────────────────────────────────────────────────

  return {
    enabled,

    async guardInput(input) {
      const inputGuards = phaseGuards('input')
      lastMessages = input.messages
      if (inputGuards.length === 0) return input

      const pipeline = createGuardrailPipeline(inputGuards)
      const actions: string[] = []
      let messages = input.messages
      let guardedAnyMessage = false

      for (let index = 0; index < messages.length; index++) {
        const message = messages[index]
        if (!message || message.role !== 'user') continue

        guardedAnyMessage = true
        const originalContent = messageText(message)
        const result = await pipeline.runInput(originalContent, guardContext('input', messages))
        appendGuardrailAudit(result.audit)
        actions.push(...result.audit.applied.map((entry) => entry.action))

        if (result.content !== originalContent) {
          const content = applyProjectedRewrite(message.content as MessageContent, originalContent, result.content)
          if (content === null) {
            const policyId = latestRewritePolicyId(result.audit.applied) ?? 'unknown'
            throw new SafetyResultError({
              policyId,
              boundary: 'user.input',
              problem: 'rewrite could not be faithfully applied to multimodal message content',
              message:
                `Safety policy "${policyId}" rewrote a multimodal message projection that no longer aligns with its media placeholders. ` +
                'Media placeholders must be preserved verbatim by rewrites; policies that need to act on media sources should block instead.',
            })
          }
          messages = messages.map((entry, entryIndex) => (entryIndex === index ? { ...entry, content } : entry))
        }
      }

      if (guardedAnyMessage) {
        lastMessages = messages
        transcript.push({ t: 'input.guard', guards: inputGuards.length, actions })
        return { messages, prompt: input.prompt }
      }

      if (input.prompt === undefined) return input

      const result = await pipeline.runInput(input.prompt, guardContext('input', input.messages))
      appendGuardrailAudit(result.audit)
      transcript.push({
        t: 'input.guard',
        guards: inputGuards.length,
        actions: result.audit.applied.map((entry) => entry.action),
      })
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

      const guardCandidate = async (candidate: SafetyOutput): Promise<SafetyOutput> =>
        phaseGuards('output').length > 0 ? applyOutputGuards(candidate, lastMessages, opts?.schema) : candidate

      let current = await guardCandidate(output)
      if (constraints.length > 0) {
        current = await applyConstraints(current, regenerate, guardCandidate)
      }
      await applyReportConstraints(current)
      return current
    },

    async guardOutputTextParts(parts) {
      return guardCompletionTextParts({
        guards: phaseGuards('output'),
        parts,
        context: guardContext('output', lastMessages),
        appendAudit: appendGuardrailAudit,
        transcript,
      })
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

/**
 * Re-apply a guarded projection rewrite to canonical message content.
 *
 * Media placeholders anchor the redistribution: every placeholder must
 * survive the rewrite verbatim, in order, and outside every text segment.
 * Returns `null` when the rewrite cannot be applied faithfully — the caller
 * fails closed instead of silently dropping the rewrite or duplicating
 * placeholder text into the prompt.
 */
function applyProjectedRewrite(
  content: MessageContent,
  originalProjection: string,
  replacement: string,
): MessageContent | null {
  if (typeof content === 'string') return replacement
  if (contentText(content) !== originalProjection) return null

  const textCount = content.filter((part) => part.type === 'text').length
  const placeholders = content.filter((part) => part.type !== 'text').map((part) => contentText([part]))

  if (placeholders.length === 0) {
    // Leading empty text parts contribute one '\n' join separator each to the
    // projection — drop exactly those separators, never rewritten content.
    let leadingEmpty = 0
    for (const part of content) {
      if (part.type !== 'text' || part.text !== '') break
      leadingEmpty++
    }
    let text = replacement
    while (leadingEmpty > 0 && text.startsWith('\n')) {
      text = text.slice(1)
      leadingEmpty--
    }
    let first = true
    return content.map((part) => {
      if (part.type !== 'text') return part
      const value = first ? text : ''
      first = false
      return { ...part, text: value }
    })
  }
  if (textCount === 0) return null
  const spoofed = content.some(
    (part) => part.type === 'text' && placeholders.some((placeholder) => part.text.includes(placeholder)),
  )
  if (spoofed) return null

  const out: string[] = []
  let cursor = 0
  let pendingText = 0

  for (const part of content) {
    if (part.type === 'text') {
      pendingText++
      continue
    }

    const placeholder = contentText([part])
    const placeholderIndex = replacement.indexOf(placeholder, cursor)
    if (placeholderIndex < 0) return null
    assignTextChunk(out, pendingText, replacement.slice(cursor, placeholderIndex), placeholderIndex > cursor)
    pendingText = 0
    cursor = placeholderIndex + placeholder.length
  }

  assignTextChunk(out, pendingText, replacement.slice(cursor), false)
  if (out.length > textCount) return null
  if (out.some((chunk) => placeholders.some((placeholder) => chunk.includes(placeholder)))) return null

  let textIndex = 0
  return content.map((part) => {
    if (part.type !== 'text') return part
    const text = out[textIndex] ?? ''
    textIndex++
    return { ...part, text }
  })
}

function assignTextChunk(out: string[], pendingText: number, chunk: string, beforeMedia: boolean): void {
  if (pendingText === 0) return
  let text = chunk
  if (text.startsWith('\n')) text = text.slice(1)
  if (beforeMedia && text.endsWith('\n')) text = text.slice(0, -1)
  out.push(text)
  for (let index = 1; index < pendingText; index++) out.push('')
}

function latestRewritePolicyId(entries: readonly GuardrailAuditEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (!entry) continue
    if (entry.action === 'redact' || entry.action === 'transform' || entry.action === 'rewrite') {
      return entry.guard
    }
  }
  return undefined
}

function guardPhase(guard: Guardrail): 'input' | 'output' {
  const boundaries = Array.isArray(guard.on) ? guard.on : [guard.on]
  return boundaries.some(isInputBoundary) ? 'input' : 'output'
}

function isInputBoundary(boundary: BoundaryDef): boolean {
  return boundary.id === 'user.input' || boundary.id === 'model.input'
}
