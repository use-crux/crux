import type { CatalogLintFinding, ProjectDefinition, ProjectRelation, ProjectSourceRef } from '@crux/core/catalog'
import type { SemanticAnalyzerResult, SemanticCatalogAnalyzer, SemanticCatalogAnalyzerContext, SemanticCatalogAnalyzerResult } from './types'

/**
 * Merges analyzer outputs into the single semantic patch shape consumed by the catalog indexer.
 *
 * Definitions merge by id, source refs dedupe by definition/ref id, and
 * relations dedupe by relation id so focused analyzers can safely report
 * overlapping facts.
 */
export function mergeSemanticAnalyzerResults(results: Iterable<SemanticAnalyzerResult>): Required<SemanticAnalyzerResult> {
  const resultList = [...results]

  return {
    definitions: mergeDefinitionPatches(resultList.flatMap((result) => result.definitions ?? [])),
    sourceRefs: uniqueBy(
      resultList.flatMap((result) => result.sourceRefs ?? []),
      (sourceRef) => `${sourceRef.definitionId}:${sourceRef.ref.id}`,
    ),
    relations: uniqueBy(
      resultList.flatMap((result) => result.relations ?? []),
      (relation) => relation.id,
    ),
  }
}

/**
 * Runs catalog-level analyzers after definition and relation facts are merged.
 */
export function runSemanticCatalogAnalyzers(
  analyzers: readonly SemanticCatalogAnalyzer[],
  context: SemanticCatalogAnalyzerContext,
): Required<SemanticCatalogAnalyzerResult> {
  return {
    lintFindings: analyzers.flatMap((analyzer) =>
      analyzer.analyzeCatalog(context).lintFindings ?? [],
    ),
  }
}

/**
 * Keeps the first item for every key while preserving encounter order.
 */
function uniqueBy<T>(items: readonly T[], keyFor: (item: T) => string): T[] {
  return items.filter((item, index) =>
    items.findIndex((candidate) => keyFor(candidate) === keyFor(item)) === index,
  )
}

/**
 * Merges definition patches by id with metadata and source refs preserved.
 */
function mergeDefinitionPatches(patches: readonly ProjectDefinition[]): ProjectDefinition[] {
  return patches.reduce<ProjectDefinition[]>(
    (merged, patch) =>
      merged.some((definition) => definition.id === patch.id)
        ? merged.map((definition) =>
            definition.id === patch.id ? mergeDefinitionPatch(definition, patch) : definition,
          )
        : [...merged, mergeDefinitionPatch(undefined, patch)],
    [],
  )
}

/**
 * Combines two partial definition records using catalog patch semantics.
 */
function mergeDefinitionPatch(existing: ProjectDefinition | undefined, patch: ProjectDefinition): ProjectDefinition {
  return {
    ...(existing ?? patch),
    ...patch,
    metadata: {
      ...(existing?.metadata ?? {}),
      ...(patch.metadata ?? {}),
    },
    sourceRefs: [...(existing?.sourceRefs ?? []), ...(patch.sourceRefs ?? [])],
  }
}
