import { planIndexFiles } from './plan'
import type { IncrementalIndexDecision, IndexFilesOptions } from './types'

/**
 * Returns a JSON-safe planner decision for worker dry-runs.
 *
 * This function intentionally does not execute indexing or mutate catalog state.
 */
export function planIndexFilesDryRun(options: IndexFilesOptions): IncrementalIndexDecision {
  return JSON.parse(JSON.stringify(planIndexFiles(options))) as IncrementalIndexDecision
}
