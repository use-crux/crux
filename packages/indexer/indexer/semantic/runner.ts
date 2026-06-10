import type { IndexLintFinding, ProjectDefinition, ProjectRelation, ProjectSourceRef } from '@crux/core/project-index'
import { mergeRelationsByIdentity } from '../relations/index'
import type { SemanticAnalyzerResult, SemanticIndexAnalyzer, SemanticIndexAnalyzerContext, SemanticIndexAnalyzerResult } from './types'

/**
 * Merges analyzer outputs into the single semantic patch shape consumed by the index indexer.
 *
 * Definitions merge by id, source refs dedupe by definition/ref id, and
 * relations merge by semantic identity so resolved analyzer facts can replace
 * lower-fidelity facts even when a producer supplied a stale or provisional id.
 */
export function mergeSemanticAnalyzerResults(results: Iterable<SemanticAnalyzerResult>): Required<SemanticAnalyzerResult> {
  const resultList = [...results]

  return {
    definitions: mergeDefinitionPatches(resultList.flatMap((result) => result.definitions ?? [])),
    sourceRefs: uniqueBy(
      resultList.flatMap((result) => result.sourceRefs ?? []),
      (sourceRef) => `${sourceRef.definitionId}:${sourceRef.ref.id}`,
    ),
    relations: mergeRelationsByIdentity(resultList.flatMap((result) => result.relations ?? [])),
  }
}

/**
 * Runs index-level analyzers after definition and relation facts are merged.
 */
export function runSemanticIndexAnalyzers(
  analyzers: readonly SemanticIndexAnalyzer[],
  context: SemanticIndexAnalyzerContext,
): Required<SemanticIndexAnalyzerResult> {
  return {
    lintFindings: analyzers.flatMap((analyzer) =>
      analyzer.analyzeIndex(context).lintFindings ?? [],
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
 * Combines two partial definition records using index patch semantics.
 */
function mergeDefinitionPatch(existing: ProjectDefinition | undefined, patch: ProjectDefinition): ProjectDefinition {
  return {
    ...(existing ?? patch),
    ...patch,
    metadata: mergeMetadata(existing?.metadata, patch.metadata),
    sourceRefs: [...(existing?.sourceRefs ?? []), ...(patch.sourceRefs ?? [])],
  }
}

/**
 * Merges definition metadata while preserving nested facts/useEntries emitted by
 * separate semantic analyzers.
 */
function mergeMetadata(
  base: ProjectDefinition['metadata'],
  overlay: ProjectDefinition['metadata'],
): ProjectDefinition['metadata'] {
  const metadata = { ...(base ?? {}), ...(overlay ?? {}) }
  const baseFacts = base?.facts
  const overlayFacts = overlay?.facts
  if (isRecord(baseFacts) || isRecord(overlayFacts)) {
    const facts = { ...(isRecord(baseFacts) ? baseFacts : {}), ...(isRecord(overlayFacts) ? overlayFacts : {}) }
    const useEntries = [
      ...(isRecord(baseFacts) && Array.isArray(baseFacts.useEntries) ? baseFacts.useEntries : []),
      ...(isRecord(overlayFacts) && Array.isArray(overlayFacts.useEntries) ? overlayFacts.useEntries : []),
    ]
    if (useEntries.length > 0) facts.useEntries = useEntries
    metadata.facts = facts as NonNullable<ProjectDefinition['metadata']>['facts']
  }
  return metadata
}

/**
 * Narrows unknown metadata values to object records.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
