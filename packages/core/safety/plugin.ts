import type { CruxPlugin, CruxPluginResult } from '../runtime/plugin'
import type { CruxHooks } from '../runtime/runtime'
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
 * Global policies apply to all `generate()`/`stream()` calls. The per-call
 * Safety registry composes global, prompt/context, and call-site policies,
 * then rejects duplicate policy ids so policy identity stays explicit.
 * Multiple safety plugins compose by concatenating their policies.
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

    install(_hooks: Readonly<CruxHooks>): CruxPluginResult {
      return {
        ...(policy.guardrails && policy.guardrails.length > 0 ? { globalGuardrails: [...policy.guardrails] } : {}),
        ...(policy.constraints && policy.constraints.length > 0 ? { globalConstraints: [...policy.constraints] } : {}),
      }
    },
  }
}
