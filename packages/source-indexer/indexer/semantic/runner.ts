import type { CatalogLintFinding, ProjectDefinition, ProjectRelation, ProjectSourceRef } from '@crux/core/catalog'
import type { SemanticAnalyzerResult, SemanticCatalogAnalyzer, SemanticCatalogAnalyzerContext, SemanticCatalogAnalyzerResult } from './types'

export function mergeSemanticAnalyzerResults(results: Iterable<SemanticAnalyzerResult>): Required<SemanticAnalyzerResult> {
  const definitionPatches = new Map<string, ProjectDefinition>()
  const sourceRefs: { definitionId: string; ref: ProjectSourceRef }[] = []
  const seenSourceRefs = new Set<string>()
  const relations: ProjectRelation[] = []
  const seenRelations = new Set<string>()

  for (const result of results) {
    for (const definition of result.definitions ?? []) {
      mergeDefinitionPatch(definitionPatches, definition)
    }
    for (const sourceRef of result.sourceRefs ?? []) {
      addSourceRef(sourceRefs, seenSourceRefs, sourceRef.definitionId, sourceRef.ref)
    }
    for (const relation of result.relations ?? []) {
      addRelation(relations, seenRelations, relation)
    }
  }

  return {
    definitions: [...definitionPatches.values()],
    sourceRefs,
    relations,
  }
}

export function runSemanticCatalogAnalyzers(
  analyzers: readonly SemanticCatalogAnalyzer[],
  context: SemanticCatalogAnalyzerContext,
): Required<SemanticCatalogAnalyzerResult> {
  const lintFindings: CatalogLintFinding[] = []
  for (const analyzer of analyzers) {
    lintFindings.push(...(analyzer.analyzeCatalog(context).lintFindings ?? []))
  }
  return { lintFindings }
}

function addSourceRef(
  sourceRefs: { definitionId: string; ref: ProjectSourceRef }[],
  seen: Set<string>,
  definitionId: string,
  ref: ProjectSourceRef,
): void {
  const key = `${definitionId}:${ref.id}`
  if (seen.has(key)) return
  seen.add(key)
  sourceRefs.push({ definitionId, ref })
}

function addRelation(relations: ProjectRelation[], seen: Set<string>, relation: ProjectRelation): void {
  if (seen.has(relation.id)) return
  seen.add(relation.id)
  relations.push(relation)
}

function mergeDefinitionPatch(patches: Map<string, ProjectDefinition>, patch: ProjectDefinition): void {
  const existing = patches.get(patch.id)
  patches.set(patch.id, {
    ...(existing ?? patch),
    ...patch,
    metadata: {
      ...(existing?.metadata ?? {}),
      ...(patch.metadata ?? {}),
    },
    sourceRefs: [...(existing?.sourceRefs ?? []), ...(patch.sourceRefs ?? [])],
  })
}
