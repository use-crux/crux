import { resolve } from 'node:path'
import type { ProjectCatalogSnapshot } from '@crux/core/catalog'
import { staticDefinitionFileSelection } from './files'
import { catalogPatchFromSnapshot, enforceCatalogPatchBudget, type CatalogPatch, type CatalogPatchBudget } from './patches'
import { semanticCatalogFactsCached } from './semantic-cache'
import { semanticSupportSources } from './semantic-support'
import { runProjectIndexingSession } from './session'

export interface IndexProjectOptions {
  root: string
  configPath?: string
  projectName?: string
  staticOnly?: boolean
  semanticBudget?: CatalogPatchBudget
  previousCatalog?: ProjectCatalogSnapshot
}

/**
 * Builds a complete Project Catalog snapshot for a local project.
 *
 * This is the stable package entry point; lifecycle orchestration lives behind
 * the indexing-session boundary so tests and workers can exercise the same path.
 */
export async function indexProject(options: IndexProjectOptions): Promise<ProjectCatalogSnapshot> {
  return runProjectIndexingSession({
    root: options.root,
    configPath: options.configPath,
    projectName: options.projectName,
    mode: options.staticOnly ? 'source-only' : 'full',
  })
}

/**
 * Builds an AST/source-only catalog patch without importing user config modules.
 */
export async function indexProjectAst(options: IndexProjectOptions): Promise<CatalogPatch> {
  return catalogPatchFromSnapshot(await indexProject({ ...options, staticOnly: true }), 'ast', 'ok')
}

/**
 * Builds a semantic enrichment patch from compiler-resolved facts within the configured budget.
 */
export async function indexProjectSemantic(options: IndexProjectOptions): Promise<CatalogPatch> {
  const root = resolve(options.root)
  const startedAt = new Date().toISOString()
  const staticSelection = staticDefinitionFileSelection(root)
  const semanticFiles = semanticFilesForIndex(staticSelection.files, options.previousCatalog)
  const fileCount = semanticFiles.length
  const basePatch: CatalogPatch = {
    schemaVersion: 1,
    phase: 'semantic',
    project: {
      root,
      ...(options.projectName ? { name: options.projectName } : {}),
      ...(options.configPath ? { configFile: options.configPath } : {}),
    },
    startedAt,
    status: 'ok',
    facts: {},
  }
  const fileBudgetPatch = enforceCatalogPatchBudget(basePatch, options.semanticBudget, { fileCount })
  if (fileBudgetPatch.status === 'degraded') {
    return { ...fileBudgetPatch, finishedAt: new Date().toISOString() }
  }

  const facts = await semanticCatalogFactsCached(root, semanticFiles)
  return enforceCatalogPatchBudget(
    {
      ...basePatch,
      facts: {
        ...facts,
        sources: semanticSupportSources(options.previousCatalog, facts.sourceRefs),
        sourceGraph: options.previousCatalog?.sourceGraph,
      },
      finishedAt: new Date().toISOString(),
    },
    options.semanticBudget,
    { fileCount },
  )
}

function semanticFilesForIndex(
  staticFiles: readonly string[],
  previousCatalog: ProjectCatalogSnapshot | undefined,
): readonly string[] {
  return [...new Set([...staticFiles, ...(previousCatalog?.sources.map((source) => source.file) ?? [])])].sort()
}
