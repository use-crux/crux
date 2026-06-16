import type { CruxPlugin, CruxPluginResult } from '../plugin'
import type { CruxRuntime } from '../runtime'
import type { Constraint } from './constraint/types'
import type { Guardrail } from './guardrail/types'

/** Global safety policy registered by {@link createSafetyPlugin}. */
export interface SafetyPolicy {
  readonly guardrails?: readonly Guardrail[]
  readonly constraints?: readonly Constraint[]
}

/**
 * Create a CruxPlugin that registers global guardrails and constraints.
 *
 * Global policies apply to all `generate()`/`stream()` calls and are merged
 * with per-prompt and per-call policies via union merge — per-call wins
 * over per-prompt wins over global when names collide. Multiple safety
 * plugins compose: their policies concatenate.
 *
 * @example
 * ```ts
 * config({
 *   plugins: [createSafetyPlugin({ guardrails: [injectionGuard, piiGuard], constraints: [citesSources] })],
 * })
 * ```
 */
export function createSafetyPlugin(policy: SafetyPolicy): CruxPlugin {
  return {
    name: 'crux:safety',

    install(_runtime: Readonly<CruxRuntime>): CruxPluginResult {
      return {
        ...(policy.guardrails && policy.guardrails.length > 0 ? { globalGuardrails: [...policy.guardrails] } : {}),
        ...(policy.constraints && policy.constraints.length > 0 ? { globalConstraints: [...policy.constraints] } : {}),
      }
    },
  }
}
