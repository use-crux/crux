/**
 * Private managed-memory write capability and capture-context transport.
 *
 * Adapter-owned capture attaches one per-call Safety capability through a
 * unique symbol. Standalone capture never receives that capability and keeps
 * the existing block-local policy behavior.
 *
 * @internal
 * @module
 */

import {
  rejectedCandidateEvidence,
  safeCaptureSummary,
} from '../safety/errors'
import { GuardrailBlockedError } from '../safety/guardrail/errors'
import { runGuardWithObservability } from '../safety/guardrail/run-guard'
import { validateMemoryWriteGuardrailResult } from '../safety/guardrail/specialized-results'
import type {
  GuardrailAudit,
  GuardrailContext,
} from '../safety/guardrail/types'
import type { GuardrailBinding } from '../safety/registry'

/** Internal outcome that keeps an intentional drop distinct from candidate data. */
export type ManagedMemoryWriteOutcome<TCandidate> =
  | { readonly action: 'continue'; readonly value: TCandidate }
  | { readonly action: 'drop' }

/** Generic candidate-preserving commit gate used only by managed capture. */
export interface ManagedMemoryWriteGuard {
  <TCandidate>(
    candidate: TCandidate,
  ): Promise<ManagedMemoryWriteOutcome<TCandidate>>
}

/** Private carrier key shared by capture options and block contexts. */
export const managedMemoryWriteGuard: unique symbol = Symbol(
  '@use-crux/core/memory/managedMemoryWriteGuard',
)

/** Object that may privately carry the originating per-call write guard. */
export type ManagedMemoryWriteGuardCarrier = {
  readonly [managedMemoryWriteGuard]?: ManagedMemoryWriteGuard
}

interface CreateManagedMemoryWriteGuardOptions {
  readonly bindings: readonly GuardrailBinding[]
  readonly context: () => GuardrailContext
  readonly appendAudit: (audit: GuardrailAudit) => void
}

/**
 * Create the candidate-preserving write capability owned by one Safety
 * session.
 */
export function createManagedMemoryWriteGuard(
  options: CreateManagedMemoryWriteGuardOptions,
): ManagedMemoryWriteGuard {
  const bindings = options.bindings.filter(
    (binding) => binding.boundary.id === 'memory.write',
  )

  return async <TCandidate>(
    candidate: TCandidate,
  ): Promise<ManagedMemoryWriteOutcome<TCandidate>> => {
    let current: unknown = candidate

    for (const binding of bindings) {
      const outcome = await runGuardWithObservability({
        binding,
        subject: current,
        ctx: options.context(),
        phase: 'output',
        streaming: false,
        last: true,
        validateResult: validateMemoryWriteGuardrailResult,
      })
      const enforcedBlock =
        outcome.result.action === 'block' && binding.mode === 'enforce'
      options.appendAudit({
        applied: [outcome.entry],
        blocked: enforcedBlock,
      })

      if (binding.mode === 'report') continue

      switch (outcome.result.action) {
        case 'allow':
        case 'warn':
          break
        case 'rewrite':
          current = outcome.result.value
          break
        case 'drop':
          return { action: 'drop' }
        case 'block':
          throw new GuardrailBlockedError({
            guardrailId: binding.policy.id,
            phase: 'output',
            reason: outcome.result.reason,
            decisions: [
              {
                policyId: binding.policy.id,
                kind: 'guardrail',
                boundary: binding.boundary.id,
                mode: binding.mode,
                action: 'block',
                reason: outcome.result.reason,
                ...(binding.tuned ? { tuned: binding.tuned } : {}),
                ...(outcome.entry.findings
                  ? { findings: outcome.entry.findings }
                  : {}),
                durationMs: outcome.durationMs,
                captured: rejectedCandidateEvidence(
                  safeCaptureSummary(serializeCandidate(current)),
                ),
              },
            ],
          })
      }
    }

    return { action: 'continue', value: current as TCandidate }
  }
}

/** Attach a guard to a fresh private carrier without creating a string field. */
export function attachManagedMemoryWriteGuard<TTarget extends object>(
  target: TTarget,
  guard: ManagedMemoryWriteGuard | undefined,
): TTarget & ManagedMemoryWriteGuardCarrier {
  if (guard) {
    Object.defineProperty(target, managedMemoryWriteGuard, {
      value: guard,
      enumerable: false,
      writable: false,
      configurable: false,
    })
  }
  return target
}

/** Read the private capability from capture options or a block context. */
export function readManagedMemoryWriteGuard(
  carrier: object,
): ManagedMemoryWriteGuard | undefined {
  return (carrier as ManagedMemoryWriteGuardCarrier)[managedMemoryWriteGuard]
}

/** Apply per-call Safety when present, otherwise preserve standalone behavior. */
export function guardManagedMemoryWrite<TCandidate>(
  candidate: TCandidate,
  context: object,
): Promise<ManagedMemoryWriteOutcome<TCandidate>> {
  const guard = readManagedMemoryWriteGuard(context)
  return guard
    ? guard(candidate)
    : Promise.resolve({ action: 'continue', value: candidate })
}

function serializeCandidate(candidate: unknown): string {
  if (typeof candidate === 'string') return candidate
  try {
    return JSON.stringify(candidate) ?? String(candidate)
  } catch {
    return String(candidate)
  }
}
