import type { CruxPlugin, CruxPluginResult } from '../../plugin'
import type { CruxRuntime } from '../../runtime'
import type { Guardrail } from './types'

/**
 * Create a CruxPlugin that registers global guardrails.
 *
 * Global guardrails apply to all `generate()` calls and are merged
 * with per-prompt, per-context, and per-call guardrails via union merge
 * (per-call wins over per-prompt wins over global when names collide).
 *
 * ```typescript
 * config({
 *   plugins: [createGuardrailPlugin([injectionGuard, piiGuard])],
 * })
 * ```
 */
export function createGuardrailPlugin(guards: readonly Guardrail[]): CruxPlugin {
  return {
    name: 'crux:guardrails',

    install(_runtime: Readonly<CruxRuntime>): CruxPluginResult {
      return {
        globalGuardrails: [...guards],
      }
    },
  }
}
