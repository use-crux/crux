import { resolve } from 'node:path'
import type { ProjectCatalogSnapshot } from '@crux/core/catalog'

export interface IndexFilesOptions {
  root: string
  files: readonly string[]
  previousCatalog: ProjectCatalogSnapshot
}

export type IncrementalIndexDecision =
  | {
      kind: 'full-reindex-required'
      reason: 'dependency-graph-not-materialized'
      root: string
      files: readonly string[]
      previousCatalogDefinitionCount: number
    }

export function planIndexFiles(options: IndexFilesOptions): IncrementalIndexDecision {
  const root = resolve(options.root)
  const files = [...new Set(options.files.map((file) => resolve(root, file)))].sort()

  return {
    kind: 'full-reindex-required',
    reason: 'dependency-graph-not-materialized',
    root,
    files,
    previousCatalogDefinitionCount: options.previousCatalog.definitions.length,
  }
}
