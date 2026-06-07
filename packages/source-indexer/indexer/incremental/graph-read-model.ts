import type { CatalogDiagnostic, CatalogSourceFile, ProjectCatalogSnapshot } from '@crux/core/catalog'
import { absoluteSourceFilePath } from './paths'
import type { AbsoluteSourceFilePath } from './types'

/**
 * Read-only lookup model derived from `ProjectCatalogSnapshot.sources`.
 */
export interface IncrementalGraphReadModel {
  readonly sourceByFile: ReadonlyMap<AbsoluteSourceFilePath, CatalogSourceFile>
  readonly dependenciesByFile: ReadonlyMap<AbsoluteSourceFilePath, readonly AbsoluteSourceFilePath[]>
  readonly dependentsByFile: ReadonlyMap<AbsoluteSourceFilePath, readonly AbsoluteSourceFilePath[]>
  readonly definitionIdsByFile: ReadonlyMap<AbsoluteSourceFilePath, readonly string[]>
  readonly diagnosticsByFile: ReadonlyMap<AbsoluteSourceFilePath, readonly CatalogDiagnostic[]>
  readonly hasMaterializedEdges: boolean
}

/**
 * Returns whether a previous catalog snapshot advertises graph evidence needed for source-closure
 * planning.
 */
export function hasTrustedSourceGraph(catalog: ProjectCatalogSnapshot): boolean {
  const capabilities = new Set(catalog.sourceGraph?.capabilities ?? [])
  return (
    catalog.sourceGraph?.schemaVersion === 1 &&
    catalog.sourceGraph.producedBy === '@crux/source-indexer' &&
    capabilities.has('source-dependencies') &&
    capabilities.has('source-dependents') &&
    capabilities.has('definition-ownership') &&
    capabilities.has('diagnostic-ownership')
  )
}

/**
 * Builds the source graph read model consumed by the incremental planner.
 *
 * The model is derived only from durable catalog rows so decisions can be reproduced across worker
 * restarts and context handoffs.
 */
export function graphReadModelFromCatalog(catalog: ProjectCatalogSnapshot): IncrementalGraphReadModel {
  const sourceByFile = new Map<AbsoluteSourceFilePath, CatalogSourceFile>()
  const dependenciesByFile = new Map<AbsoluteSourceFilePath, readonly AbsoluteSourceFilePath[]>()
  const dependentsByFile = new Map<AbsoluteSourceFilePath, readonly AbsoluteSourceFilePath[]>()
  const definitionIdsByFile = new Map<AbsoluteSourceFilePath, readonly string[]>()
  const diagnosticsByFile = diagnosticsBySourceFile(catalog.diagnostics)
  const diagnosticById = new Map<string, CatalogDiagnostic>(catalog.diagnostics.map((diagnostic) => [diagnostic.id, diagnostic]))
  let hasMaterializedEdges = false

  for (const source of catalog.sources) {
    const file = absoluteSourceFilePath(source.file)
    sourceByFile.set(file, source)

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
          .filter((diagnostic): diagnostic is CatalogDiagnostic => diagnostic !== undefined),
      ])
    }
  }

  return {
    sourceByFile,
    dependenciesByFile,
    dependentsByFile,
    definitionIdsByFile,
    diagnosticsByFile,
    hasMaterializedEdges,
  }
}

function normalizePathList(files: readonly string[]): readonly AbsoluteSourceFilePath[] {
  return [...new Set(files.map(absoluteSourceFilePath))].sort()
}

function diagnosticsBySourceFile(
  diagnostics: readonly CatalogDiagnostic[],
): Map<AbsoluteSourceFilePath, readonly CatalogDiagnostic[]> {
  const byFile = new Map<AbsoluteSourceFilePath, CatalogDiagnostic[]>()
  for (const diagnostic of diagnostics) {
    if (!diagnostic.source?.file) continue
    const file = absoluteSourceFilePath(diagnostic.source.file)
    byFile.set(file, [...(byFile.get(file) ?? []), diagnostic])
  }
  return byFile
}
