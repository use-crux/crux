import { basename } from 'node:path'
import { catalogBoundaryFileNames } from './boundaries'
import type { IncrementalGraphReadModel } from './graph-read-model'
import type { AbsoluteSourceFilePath } from './types'

const BROAD_BOUNDARY_FILES = new Set<string>(catalogBoundaryFileNames)

/**
 * Returns whether a changed file should invalidate the whole catalog boundary.
 */
export function isBroadBoundaryFile(file: AbsoluteSourceFilePath): boolean {
  return BROAD_BOUNDARY_FILES.has(basename(file))
}

/**
 * Returns changed files that are absent from the previous source graph.
 */
export function unknownChangedFiles(
  graph: IncrementalGraphReadModel,
  files: readonly AbsoluteSourceFilePath[],
): readonly AbsoluteSourceFilePath[] {
  return files.filter((file) => !graph.sourceByFile.has(file))
}

/**
 * Returns whether affected files carry diagnostics that make partial graph planning unsafe.
 */
export function hasUnresolvedImportDiagnostics(
  graph: IncrementalGraphReadModel,
  files: readonly AbsoluteSourceFilePath[],
): boolean {
  return files.some((file) =>
    (graph.diagnosticsByFile.get(file) ?? []).some((diagnostic) => unresolvedImportCode(diagnostic.code)),
  )
}

function unresolvedImportCode(code: string): boolean {
  return code === 'catalog.rich_import_failed' || code === 'catalog.module_import_failed'
}
