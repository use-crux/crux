/**
 * Safety-shaped execution for memory write policy hooks.
 *
 * Memory blocks own storage and extraction, but their `redact`, `validate`,
 * and `shouldRemember` hooks are write-boundary safety decisions. This module
 * adapts those hooks into the shared `SafetyDecision` read model without
 * changing the existing candidate-or-null memory contract.
 *
 * @module
 */

import type { SafetyDecision } from '../safety/decision'
import { safeCaptureSummary } from '../safety/errors'
import type { MemoryBlockContext, MemoryPolicy } from './contracts'
import { guardManagedMemoryWrite } from './managed-write-guard'

/** Policy hook that produced one memory write decision. */
export type MemoryPolicyDecisionHook = 'redact' | 'validate' | 'shouldRemember'

/** Decision emitted while applying a memory policy hook. */
export interface MemoryPolicyDecisionEvent {
  readonly hook: MemoryPolicyDecisionHook
  readonly decision: SafetyDecision
}

/** Options for {@link applyMemoryPolicy}. */
export interface ApplyMemoryPolicyOptions {
  /** Stable prefix used to build hook policy ids. */
  readonly policyIdPrefix: string
  /** Monotonic-ish clock, injected by callers for consistency with memory spans. */
  readonly now: () => number
  /** Observer invoked after each hook decision. */
  readonly onDecision?: (event: MemoryPolicyDecisionEvent) => void
}

/**
 * Apply an existing memory policy and emit Safety-shaped decisions for every
 * hook that runs.
 *
 * Runtime semantics are unchanged: the returned value is the candidate to
 * persist/propose, and `null` means the candidate was dropped.
 */
export async function applyMemoryPolicy<T>(
  candidate: T,
  policy: MemoryPolicy<T> | undefined,
  ctx: MemoryBlockContext,
  options: ApplyMemoryPolicyOptions,
): Promise<T | null> {
  let next = candidate
  if (policy?.redact) {
    const before = next
    const startedAt = options.now()
    next = await policy.redact(next, ctx)
    emitDecision(options, {
      hook: 'redact',
      action: valuesEqual(before, next) ? 'allow' : 'rewrite',
      candidate: next,
      durationMs: options.now() - startedAt,
    })
  }

  const guarded = await guardManagedMemoryWrite(next, ctx)
  if (guarded.action === 'drop') return null
  next = guarded.value

  if (policy?.validate) {
    const startedAt = options.now()
    const parsed = policy.validate.safeParse(next)
    if (!parsed.success) {
      emitDecision(options, {
        hook: 'validate',
        action: 'drop',
        candidate: next,
        durationMs: options.now() - startedAt,
        reason: 'memory candidate failed policy validation',
      })
      return null
    }
    next = parsed.data
    emitDecision(options, {
      hook: 'validate',
      action: 'allow',
      candidate: next,
      durationMs: options.now() - startedAt,
    })
  }

  if (policy?.shouldRemember) {
    const startedAt = options.now()
    const shouldRemember = await policy.shouldRemember(next, ctx)
    emitDecision(options, {
      hook: 'shouldRemember',
      action: shouldRemember ? 'allow' : 'drop',
      candidate: next,
      durationMs: options.now() - startedAt,
      ...(!shouldRemember ? { reason: 'memory candidate was dropped by policy' } : {}),
    })
    if (!shouldRemember) return null
  }

  return next
}

function emitDecision<T>(
  options: ApplyMemoryPolicyOptions,
  input: {
    readonly hook: MemoryPolicyDecisionHook
    readonly action: Extract<SafetyDecision['action'], 'allow' | 'rewrite' | 'drop'>
    readonly candidate: T
    readonly durationMs: number
    readonly reason?: string
  },
): void {
  const policyId = `${options.policyIdPrefix}.${input.hook}`
  options.onDecision?.({
    hook: input.hook,
    decision: {
      policyId,
      kind: 'guardrail',
      boundary: 'memory.write',
      mode: 'enforce',
      action: input.action,
      ...(input.reason ? { reason: input.reason } : {}),
      durationMs: input.durationMs,
      captured: safeCaptureSummary(serializeMemoryPolicyCandidate(input.candidate)),
    },
  })
}

function serializeMemoryPolicyCandidate(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}
