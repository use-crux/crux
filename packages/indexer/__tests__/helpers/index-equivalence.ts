import type { ProjectIndexSnapshot } from '@use-crux/core/project-index'
import { applyIndexPatch, indexPatchFromSnapshot, emptyIndexPatchState } from '../../indexer/patches'

/**
 * Applies a full snapshot patch and returns a normalized comparable state.
 */
export function normalizedIndexStateFromSnapshot(snapshot: ProjectIndexSnapshot): unknown {
  const state = applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(snapshot, 'ast', 'ok'))
  return JSON.parse(
    JSON.stringify({
      project: state.project,
      prompts: state.prompts,
      contexts: state.contexts,
      tools: state.tools,
      lint: state.lint,
      sourceGraph: state.sourceGraph,
      definitions: state.definitions,
      relations: state.relations,
      diagnostics: state.diagnostics,
      lintFindings: state.lintFindings,
      sources: state.sources,
    }),
  ) as unknown
}
