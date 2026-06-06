import { affectedDefinitionIds, dependentClosure } from './closure'
import { hasUnresolvedImportDiagnostics, isBroadBoundaryFile, unknownChangedFiles } from './classify'
import { dependencyClosureDecision, fullReindexDecision, sourceFileDecision } from './decisions'
import { graphReadModelFromCatalog, hasTrustedSourceGraph } from './graph-read-model'
import { normalizeChangedFiles, normalizeRoot } from './paths'
import type { IncrementalIndexDecision, IndexFilesOptions } from './types'

const DEFAULT_MAX_AFFECTED_FILES = 1_000

/**
 * Computes catalog work affected by changed files.
 *
 * This is a planning-only API. It returns a full reindex decision whenever previous catalog graph
 * evidence cannot prove a complete affected closure.
 */
export function planIndexFiles(options: IndexFilesOptions): IncrementalIndexDecision {
  const root = normalizeRoot(options.root)
  const files = normalizeChangedFiles(root, options.files)
  const deletedFiles = normalizeChangedFiles(root, options.deletedFiles ?? [])
  const allChangedFiles = [...new Set([...files, ...deletedFiles])].sort()

  if (!options.previousCatalog) {
    return fullReindexDecision({
      reason: 'missing-previous-catalog',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'missing-previous-catalog',
      previousCatalogDefinitionCount: 0,
      summary: 'No previous catalog snapshot was available for incremental planning.',
    })
  }

  const previousCatalogDefinitionCount = options.previousCatalog.definitions.length
  if (options.previousCatalog.sources.length === 0) {
    return fullReindexDecision({
      reason: 'missing-source-graph',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'missing-source-graph',
      previousCatalogDefinitionCount,
      summary: 'Previous catalog snapshot did not contain source graph rows.',
    })
  }

  if (!hasTrustedSourceGraph(options.previousCatalog)) {
    return fullReindexDecision({
      reason: 'source-graph-marker-missing',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'source-graph-marker-missing',
      previousCatalogDefinitionCount,
      summary: 'Previous catalog snapshot did not advertise trusted source graph evidence.',
    })
  }

  const graph = graphReadModelFromCatalog(options.previousCatalog)
  if (!graph.hasMaterializedEdges) {
    return fullReindexDecision({
      reason: 'dependency-graph-not-materialized',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'missing-dependent-edges',
      previousCatalogDefinitionCount,
      summary: 'Previous catalog source rows did not materialize dependency or dependent edges.',
    })
  }

  if (allChangedFiles.some(isBroadBoundaryFile)) {
    return fullReindexDecision({
      reason: 'config-or-resolver-changed',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'config-or-resolver-changed',
      previousCatalogDefinitionCount,
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
      previousCatalogDefinitionCount,
      summary: 'At least one changed file was not represented in the previous catalog source graph.',
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
      previousCatalogDefinitionCount,
      summary: 'At least one deleted file was not represented in the previous catalog source graph.',
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
      previousCatalogDefinitionCount,
      summary: 'A deleted file had graph edges that require a full catalog reindex.',
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
      previousCatalogDefinitionCount,
      summary: 'The affected dependent closure exceeded the planner budget.',
    })
  }

  if (hasUnresolvedImportDiagnostics(graph, affectedFiles)) {
    return fullReindexDecision({
      reason: 'unresolved-imports-present',
      root,
      files: allChangedFiles,
      deletedFiles,
      graphConfidence: 'unresolved-imports-present',
      previousCatalogDefinitionCount,
      summary: 'The affected source component has unresolved import diagnostics in the previous catalog graph.',
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
