import type { IncrementalIndexDecision } from './types'

/**
 * Returns the stable explanation payload for an incremental planner decision.
 */
export function explainIncrementalDecision(decision: IncrementalIndexDecision): string {
  switch (decision.kind) {
    case 'full-reindex-required':
      return `${decision.explanation.summary} Full reindex reason: ${decision.reason}.`
    case 'source-file-reindex':
      return `${decision.explanation.summary} Affected files: ${decision.affectedFiles.length}.`
    case 'dependency-closure-reindex':
      return `${decision.explanation.summary} Affected files: ${decision.affectedFiles.length}.`
    case 'semantic-closure-reindex':
      return `${decision.explanation.summary} Semantic partial execution is not implied.`
  }
  return assertNever(decision)
}

function assertNever(value: never): never {
  throw new Error(`Unhandled incremental decision: ${JSON.stringify(value)}`)
}
