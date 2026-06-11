import type { IndexPatch } from '../patches'
import type { IncrementalIndexDecision } from './types'

export type IndexPatchInvalidation = NonNullable<IndexPatch['invalidates']>

/**
 * Converts a planner decision into index patch invalidation fields.
 *
 * This adapter is planning infrastructure only. Future partial executors should consume this instead
 * of inventing invalidation semantics in worker code.
 */
export function indexInvalidationFromDecision(decision: IncrementalIndexDecision): IndexPatchInvalidation {
  switch (decision.kind) {
    case 'full-reindex-required':
      return { all: true }
    case 'source-file-reindex':
    case 'dependency-closure-reindex':
      return {
        files: decision.affectedFiles,
        definitionIds: decision.affectedDefinitionIds,
      }
    case 'semantic-closure-reindex':
      return {
        files: decision.affectedFiles,
        definitionIds: decision.affectedDefinitionIds,
      }
  }
  return assertNever(decision)
}

function assertNever(value: never): never {
  throw new Error(`Unhandled incremental decision invalidation: ${JSON.stringify(value)}`)
}
