/**
 * Proactive token budget tracking.
 *
 * Advisory system that tracks token usage across sources and computes
 * pressure levels. Does not perform any compaction — it tells you when to,
 * and you decide how.
 *
 * @module
 */

import type { BudgetConfig, BudgetManager, BudgetState } from './types'
import { observe } from '../observability'
import { getRuntime } from '../runtime/runtime'

/**
 * Create a budget manager that tracks token usage and reports pressure levels.
 *
 * Fully synchronous — no LLM calls, no promises, no side effects.
 *
 * @param config - Budget configuration with limit and optional thresholds.
 * @returns A `BudgetManager` with report/check/reset methods.
 */
export function createBudgetManager(config: BudgetConfig): BudgetManager {
  const { limit, warningThreshold = 0.8, criticalThreshold = 0.95 } = config
  const sources = new Map<string, number>()

  function report(source: string, tokens: number): void {
    sources.set(source, tokens)
  }

  function check(): BudgetState {
    const span = observe.openSpan({
      name: 'budget.check',
      primitive: 'prompt.budget',
      attributes: {
        limit,
        warningThreshold,
        criticalThreshold,
        sourceCount: sources.size,
      },
    })
    let used = 0
    const breakdown: Record<string, number> = {}

    try {
      for (const [source, tokens] of sources) {
        used += tokens
        breakdown[source] = tokens
      }

      const pressure = limit > 0 ? used / limit : 0
      const level: BudgetState['level'] =
        pressure >= criticalThreshold ? 'critical' : pressure >= warningThreshold ? 'warning' : 'normal'

      const available = Math.max(0, limit - used)

      span.withContext(() => {
        observe.event({
          name: 'budget.checked',
          attributes: { used, available, pressure, level, breakdown },
        })
      })
      span.end({
        attributes: {
          limit,
          warningThreshold,
          criticalThreshold,
          sourceCount: sources.size,
          used,
          available,
          pressure,
          level,
          breakdown,
        },
      })

      return {
        used,
        available,
        pressure,
        level,
        breakdown,
      }
    } catch (error) {
      span.error(error, { limit, warningThreshold, criticalThreshold, sourceCount: sources.size })
      throw error
    }
  }

  function reset(): void {
    sources.clear()
  }

  return { report, check, reset }
}
