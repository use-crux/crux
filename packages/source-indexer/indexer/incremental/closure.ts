import type { IncrementalGraphReadModel } from './graph-read-model'
import type { AbsoluteSourceFilePath } from './types'

/**
 * Computes the changed files plus every known reverse dependent.
 *
 * Traversal is deterministic and cycle-safe. Callers should still enforce a budget before trusting a
 * partial plan on very large closures.
 */
export function dependentClosure(
  graph: IncrementalGraphReadModel,
  changedFiles: readonly AbsoluteSourceFilePath[],
): readonly AbsoluteSourceFilePath[] {
  const seen = new Set<AbsoluteSourceFilePath>()
  const queue = [...changedFiles].sort()

  while (queue.length > 0) {
    const file = queue.shift()
    if (!file || seen.has(file)) continue
    seen.add(file)

    for (const dependent of graph.dependentsByFile.get(file) ?? []) {
      if (!seen.has(dependent)) queue.push(dependent)
    }
    queue.sort()
  }

  return [...seen].sort()
}

/**
 * Collects catalog definition ids owned by affected files.
 */
export function affectedDefinitionIds(
  graph: IncrementalGraphReadModel,
  affectedFiles: readonly AbsoluteSourceFilePath[],
): readonly string[] {
  return [...new Set(affectedFiles.flatMap((file) => graph.definitionIdsByFile.get(file) ?? []))].sort()
}
