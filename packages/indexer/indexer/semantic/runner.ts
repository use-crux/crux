import type { IndexLintFinding, ProjectDefinition, ProjectRelation, ProjectSourceRef } from '@crux/core/project-index'
import { mergeRelationsByIdentity } from '../relations/index'
import type { SemanticAnalyzerResult, SemanticIndexAnalyzer, SemanticIndexAnalyzerContext, SemanticIndexAnalyzerResult } from './types'

/**
 * Merges analyzer outputs into the single semantic patch shape consumed by the index indexer.
 *
 * Definitions merge by id, source refs dedupe by definition/ref id/source
 * location, and relations merge by semantic identity so resolved analyzer facts
 * can replace lower-fidelity facts even when a producer supplied a stale or
 * provisional id.
 */
export function mergeSemanticAnalyzerResults(results: Iterable<SemanticAnalyzerResult>): Required<SemanticAnalyzerResult> {
  const resultList = [...results]

  return {
    definitions: mergeDefinitionPatches(resultList.flatMap((result) => result.definitions ?? [])),
    sourceRefs: uniqueBy(
      resultList.flatMap((result) => result.sourceRefs ?? []),
      sourceRefMergeKey,
    ),
    relations: mergeRelationsByIdentity(resultList.flatMap((result) => result.relations ?? [])),
  }
}

function sourceRefMergeKey(sourceRef: { readonly definitionId: string; readonly ref: ProjectSourceRef }): string {
  const source = sourceRef.ref.source
  return [
    sourceRef.definitionId,
    sourceRef.ref.id,
    source.file,
    source.line ?? '',
    source.column ?? '',
    source.function ?? '',
  ].join(':')
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
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    const key = keyFor(item)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  return unique
}

/**
 * Merges definition patches by id with metadata and source refs preserved.
 */
function mergeDefinitionPatches(patches: readonly ProjectDefinition[]): ProjectDefinition[] {
  const merged = new Map<string, ProjectDefinition>()
  const order: string[] = []
  for (const patch of patches) {
    const existing = merged.get(patch.id)
    if (!existing) order.push(patch.id)
    merged.set(patch.id, mergeDefinitionPatch(existing, patch))
  }
  return order.flatMap((id) => merged.get(id) ?? [])
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
  const blocks = mergeMetadataBlocks(base?.blocks, overlay?.blocks)
  if (blocks.length > 0) {
    metadata.blocks = blocks as NonNullable<ProjectDefinition['metadata']>['blocks']
    metadata.blockCount = blocks.length
    const schemas = blocks.map((block) => block.schema).filter(Boolean)
    if (schemas.length === 1) metadata.schema = schemas[0] as NonNullable<ProjectDefinition['metadata']>['schema']
  }
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

function mergeMetadataBlocks(base: unknown, overlay: unknown): Array<Record<string, unknown>> {
  const blocks = [...metadataBlocks(base), ...metadataBlocks(overlay)]
  const merged = new Map<string, Record<string, unknown>>()
  for (const block of blocks) {
    const key = typeof block.id === 'string' ? block.id : JSON.stringify(block)
    merged.set(key, { ...(merged.get(key) ?? {}), ...block })
  }
  return [...merged.values()]
}

function metadataBlocks(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

/**
 * Narrows unknown metadata values to object records.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
