import type { SafetyDecision } from '../decision'
import { POLICY_TERMINAL, type PolicyTerminalError } from '../errors'

/**
 * Thrown when a guardrail blocks content.
 *
 * This happens when a guard returns `{ action: 'block' }`.
 */
export class GuardrailBlockedError extends Error implements PolicyTerminalError {
  readonly [POLICY_TERMINAL] = true
  readonly guardrailId: string
  readonly phase: 'input' | 'output'
  readonly reason: string
  readonly decisions: readonly SafetyDecision[]

  constructor(opts: {
    guardrailId: string
    phase: 'input' | 'output'
    reason: string
    decisions?: readonly SafetyDecision[]
  }) {
    super(`Guardrail "${opts.guardrailId}" blocked: ${opts.reason}`)
    this.name = 'GuardrailBlockedError'
    this.guardrailId = opts.guardrailId
    this.phase = opts.phase
    this.reason = opts.reason
    this.decisions = opts.decisions ?? []
  }
}
