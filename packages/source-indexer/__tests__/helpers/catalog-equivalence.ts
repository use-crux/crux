import type { ProjectCatalogSnapshot } from '@crux/core/catalog'
import { applyCatalogPatch, catalogPatchFromSnapshot, emptyCatalogPatchState } from '../../indexer/patches'

/**
 * Applies a full snapshot patch and returns a normalized comparable state.
 */
export function normalizedCatalogStateFromSnapshot(snapshot: ProjectCatalogSnapshot): unknown {
  const state = applyCatalogPatch(emptyCatalogPatchState(), catalogPatchFromSnapshot(snapshot, 'ast', 'ok'))
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
