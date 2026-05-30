import type { CruxPlugin, CruxPluginResult } from '../../plugin'
import type { CruxRuntime } from '../../runtime'
import type { Constraint } from './types'

/**
 * Create a CruxPlugin that registers global constraints.
 *
 * Global constraints apply to all `generate()` calls and are merged
 * with per-prompt and per-call constraints via union merge (per-call wins
 * over per-prompt wins over global when names collide).
 *
 * ```typescript
 * config({
 *   plugins: [createConstraintPlugin([targetLanguage, noPII])],
 * })
 * ```
 */
export function createConstraintPlugin(constraints: readonly Constraint[]): CruxPlugin {
  return {
    name: 'crux:constraints',

    install(_runtime: Readonly<CruxRuntime>): CruxPluginResult {
      return {
        globalConstraints: [...constraints],
      }
    },
  }
}
