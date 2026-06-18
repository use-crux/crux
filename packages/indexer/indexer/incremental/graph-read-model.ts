import type { IndexDiagnostic, IndexSourceFile, ProjectIndexShard, ProjectIndexSnapshot } from '@crux/core/project-index'
import { absoluteSourceFilePath } from './paths'
import type { AbsoluteSourceFilePath } from './types'

/**
 * Read-only lookup model derived from `ProjectIndexSnapshot.sources`.
 */
export interface IncrementalGraphReadModel {
  readonly sourceByFile: ReadonlyMap<AbsoluteSourceFilePath, IndexSourceFile>
  readonly dependenciesByFile: ReadonlyMap<AbsoluteSourceFilePath, readonly AbsoluteSourceFilePath[]>
  readonly dependentsByFile: ReadonlyMap<AbsoluteSourceFilePath, readonly AbsoluteSourceFilePath[]>
  readonly definitionIdsByFile: ReadonlyMap<AbsoluteSourceFilePath, readonly string[]>
  readonly diagnosticsByFile: ReadonlyMap<AbsoluteSourceFilePath, readonly IndexDiagnostic[]>
  readonly shardById: ReadonlyMap<string, ProjectIndexShard>
  readonly shardIdByFile: ReadonlyMap<AbsoluteSourceFilePath, string>
  readonly hasMaterializedEdges: boolean
}

/**
 * Returns whether a previous index snapshot advertises graph evidence needed for source-closure
 * planning.
 */
export function hasTrustedSourceGraph(index: ProjectIndexSnapshot): boolean {
  const capabilities = new Set(index.sourceGraph?.capabilities ?? [])
  return (
    index.sourceGraph?.schemaVersion === 1 &&
    index.sourceGraph.producedBy === '@crux/indexer' &&
    capabilities.has('source-dependencies') &&
    capabilities.has('source-dependents') &&
    capabilities.has('definition-ownership') &&
    capabilities.has('diagnostic-ownership') &&
    capabilities.has('project-shards') &&
    (index.sourceGraph.shards?.length ?? 0) > 0
  )
}

/**
 * Builds the source graph read model consumed by the incremental planner.
 *
 * The model is derived only from durable index rows so decisions can be reproduced across worker
 * restarts and context handoffs.
 */
export function graphReadModelFromIndex(index: ProjectIndexSnapshot): IncrementalGraphReadModel {
  const sourceByFile = new Map<AbsoluteSourceFilePath, IndexSourceFile>()
  const dependenciesByFile = new Map<AbsoluteSourceFilePath, readonly AbsoluteSourceFilePath[]>()
  const dependentsByFile = new Map<AbsoluteSourceFilePath, readonly AbsoluteSourceFilePath[]>()
  const definitionIdsByFile = new Map<AbsoluteSourceFilePath, readonly string[]>()
  const diagnosticsByFile = diagnosticsBySourceFile(index.diagnostics)
  const diagnosticById = new Map<string, IndexDiagnostic>(index.diagnostics.map((diagnostic) => [diagnostic.id, diagnostic]))
  const shardById = new Map<string, ProjectIndexShard>((index.sourceGraph?.shards ?? []).map((shard) => [shard.id, shard]))
  const shardIdByFile = new Map<AbsoluteSourceFilePath, string>()
  let hasMaterializedEdges = false

  for (const source of index.sources) {
    const file = absoluteSourceFilePath(source.file)
    sourceByFile.set(file, source)
    const shardId = source.shardId ?? shardIdForFile(source.file, index.sourceGraph?.shards ?? [])
    if (shardId) shardIdByFile.set(file, shardId)

    if (source.dependencies) {
      dependenciesByFile.set(file, normalizePathList(source.dependencies))
      hasMaterializedEdges = true
    }
    if (source.dependents) {
      dependentsByFile.set(file, normalizePathList(source.dependents))
      hasMaterializedEdges = true
    }
    if (source.definitionIds) {
      definitionIdsByFile.set(file, [...new Set(source.definitionIds)].sort())
    }
    if (source.diagnostics) {
      diagnosticsByFile.set(file, [
        ...(diagnosticsByFile.get(file) ?? []),
        ...source.diagnostics
          .map((id) => diagnosticById.get(id))
          .filter((diagnostic): diagnostic is IndexDiagnostic => diagnostic !== undefined),
      ])
    }
  }

  return {
    sourceByFile,
    dependenciesByFile,
    dependentsByFile,
    definitionIdsByFile,
    diagnosticsByFile,
    shardById,
    shardIdByFile,
    hasMaterializedEdges,
  }
}

function shardIdForFile(file: string, shards: readonly ProjectIndexShard[]): string | undefined {
  return [...shards]
    .sort((a, b) => b.root.length - a.root.length)
    .find((shard) => file === shard.root || file.startsWith(`${shard.root}/`))?.id
}

function normalizePathList(files: readonly string[]): readonly AbsoluteSourceFilePath[] {
  return [...new Set(files.map(absoluteSourceFilePath))].sort()
}

function diagnosticsBySourceFile(
  diagnostics: readonly IndexDiagnostic[],
): Map<AbsoluteSourceFilePath, readonly IndexDiagnostic[]> {
  const byFile = new Map<AbsoluteSourceFilePath, IndexDiagnostic[]>()
  for (const diagnostic of diagnostics) {
    if (!diagnostic.source?.file) continue
    const file = absoluteSourceFilePath(diagnostic.source.file)
    byFile.set(file, [...(byFile.get(file) ?? []), diagnostic])
  }
  return byFile
}
