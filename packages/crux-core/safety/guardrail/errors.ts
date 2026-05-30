import type { GuardrailPhase } from './types'

/**
 * Thrown when a guardrail blocks content.
 *
 * This happens when a guard returns `{ action: 'block' }`.
 */
export class GuardrailBlockedError extends Error {
  readonly guardrailId: string
  readonly phase: GuardrailPhase
  readonly reason: string

  constructor(opts: {
    guardrailId: string
    phase: GuardrailPhase
    reason: string
  }) {
    super(`Guardrail "${opts.guardrailId}" blocked: ${opts.reason}`)
    this.name = 'GuardrailBlockedError'
    this.guardrailId = opts.guardrailId
    this.phase = opts.phase
    this.reason = opts.reason
  }
}
