import { affectedDefinitionIds, dependentClosure } from './closure'
import { hasUnresolvedImportDiagnostics, isBroadBoundaryFile, unknownChangedFiles } from './classify'
import { dependencyClosureDecision, fullReindexDecision, sourceFileDecision } from './decisions'
import { graphReadModelFromIndex, hasTrustedSourceGraph } from './graph-read-model'
import { absoluteSourceFilePath, normalizeChangedFiles, normalizeRoot } from './paths'
import type { IncrementalIndexDecision, IndexFilesOptions } from './types'

const DEFAULT_MAX_AFFECTED_FILES = 1_000

/**
 * Computes index work affected by changed files.
 *
 * This is a planning-only API. It returns a full reindex decision whenever previous index graph
 * evidence cannot prove a complete affected closure.
 */
export function planIndexFiles(options: IndexFilesOptions): IncrementalIndexDecision {
  const root = normalizeRoot(options.root)
  const files = normalizeChangedFiles(root, options.files)
  const deletedFiles = normalizeChangedFiles(root, options.deletedFiles ?? [])
  const allChangedFiles = [...new Set([...files, ...deletedFiles])].sort()

  if (!options.previousIndex) {
    return fullReindexDecision({
      reason: 'missing-previous-index',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'missing-previous-index',
      previousIndexDefinitionCount: 0,
      summary: 'No previous index snapshot was available for incremental planning.',
    })
  }

  const previousIndexDefinitionCount = options.previousIndex.definitions.length
  if (options.previousIndex.sources.length === 0) {
    return fullReindexDecision({
      reason: 'missing-source-graph',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'missing-source-graph',
      previousIndexDefinitionCount,
      summary: 'Previous index snapshot did not contain source graph rows.',
    })
  }

  if (!hasTrustedSourceGraph(options.previousIndex)) {
    return fullReindexDecision({
      reason: 'source-graph-marker-missing',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'source-graph-marker-missing',
      previousIndexDefinitionCount,
      summary: 'Previous index snapshot did not advertise trusted source graph evidence.',
    })
  }

  const graph = graphReadModelFromIndex(options.previousIndex)
  if (!graph.hasMaterializedEdges) {
    return fullReindexDecision({
      reason: 'dependency-graph-not-materialized',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'missing-dependent-edges',
      previousIndexDefinitionCount,
      summary: 'Previous index source rows did not materialize dependency or dependent edges.',
    })
  }

  if (allChangedFiles.some(isBroadBoundaryFile)) {
    return fullReindexDecision({
      reason: 'config-or-resolver-changed',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'config-or-resolver-changed',
      previousIndexDefinitionCount,
      summary: 'A changed file can alter project config, compiler resolution, or workspace membership.',
    })
  }

  const unknownFiles = unknownChangedFiles(graph, files)
  if (unknownFiles.length > 0) {
    return fullReindexDecision({
      reason: 'unknown-file',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'unknown-file',
      previousIndexDefinitionCount,
      summary: 'At least one changed file was not represented in the previous index source graph.',
    })
  }

  const unknownDeletedFiles = unknownChangedFiles(graph, deletedFiles)
  if (unknownDeletedFiles.length > 0) {
    return fullReindexDecision({
      reason: 'deleted-file-unknown',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'deleted-file-unknown',
      previousIndexDefinitionCount,
      summary: 'At least one deleted file was not represented in the previous index source graph.',
    })
  }

  const unsafeDeletedFiles = deletedFiles.filter((file) => {
    const dependencies = graph.dependenciesByFile.get(file) ?? []
    const dependents = graph.dependentsByFile.get(file) ?? []
    return dependencies.length > 0 || dependents.length > 0
  })
  if (unsafeDeletedFiles.length > 0) {
    return fullReindexDecision({
      reason: 'deleted-file-unsafe',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'deleted-file-unsafe',
      previousIndexDefinitionCount,
      summary: 'A deleted file had graph edges that require a full index reindex.',
    })
  }

  const affectedFiles = dependentClosure(graph, allChangedFiles)
  if (affectedFiles.length > (options.maxAffectedFiles ?? DEFAULT_MAX_AFFECTED_FILES)) {
    return fullReindexDecision({
      reason: 'closure-budget-exceeded',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'closure-budget-exceeded',
      previousIndexDefinitionCount,
      summary: 'The affected dependent closure exceeded the planner budget.',
    })
  }

  if (!hasCompleteShardEvidence(graph, allChangedFiles, affectedFiles)) {
    return fullReindexDecision({
      reason: 'cross-shard-evidence-incomplete',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'cross-shard-evidence-incomplete',
      previousIndexDefinitionCount,
      summary: 'The affected source closure crossed project shards without complete shard reference evidence.',
      graphAvailable: true,
    })
  }

  if (hasUnresolvedImportDiagnostics(graph, affectedFiles)) {
    return fullReindexDecision({
      reason: 'unresolved-imports-present',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'unresolved-imports-present',
      previousIndexDefinitionCount,
      summary: 'The affected source component has unresolved import diagnostics in the previous index graph.',
      graphAvailable: true,
    })
  }

  const definitions = affectedDefinitionIds(graph, affectedFiles)
  const changedFiles = allChangedFiles
  const hasDependents = affectedFiles.some((file) => !changedFiles.includes(file))

  return hasDependents
    ? dependencyClosureDecision({ root, changedFiles, deletedFiles, affectedFiles, affectedDefinitionIds: definitions })
    : sourceFileDecision({ root, changedFiles, deletedFiles, affectedFiles, affectedDefinitionIds: definitions })
}

function hasCompleteShardEvidence(
  graph: ReturnType<typeof graphReadModelFromIndex>,
  changedFiles: readonly string[],
  affectedFiles: readonly string[],
): boolean {
  const changedShardIds = new Set(
    changedFiles.map((file) => graph.shardIdByFile.get(absoluteSourceFilePath(file))).filter(isString),
  )
  if (changedShardIds.size === 0) return false
  for (const file of affectedFiles) {
    const shardId = graph.shardIdByFile.get(absoluteSourceFilePath(file))
    if (!shardId) return false
    if (changedShardIds.has(shardId)) continue
    if (![...changedShardIds].some((changedShardId) => shardReferences(graph, shardId, changedShardId))) return false
  }
  return true
}

function shardReferences(graph: ReturnType<typeof graphReadModelFromIndex>, fromShardId: string, toShardId: string): boolean {
  return graph.shardById.get(fromShardId)?.references?.includes(toShardId) ?? false
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
