import { resolve } from 'node:path'
import type { ProjectIndexSnapshot, ProjectModelResolutionMode } from '@crux/core/project-index'
import {
  astIndexPatchFromCompilerResult,
  compileProjectIndex,
  projectIndexSnapshotFromCompilerResult,
} from './compiler'
import { staticDefinitionFileSelection } from './files'
import { enforceIndexPatchBudget, type IndexPatch, type IndexPatchBudget } from './patches'
import { semanticIndexFactsCached } from './semantic-cache'
import { semanticSupportSources } from './semantic-support'

export interface IndexProjectOptions {
  /** Project root used for source discovery and config lookup. */
  readonly root: string
  /** Optional Crux config path, relative to `root` unless already absolute. */
  readonly configPath?: string
  /** Optional project name supplied by an embedding CLI or server. */
  readonly projectName?: string
  /** Controls how much evidence the Project Index compiler may gather. */
  readonly resolutionMode?: ProjectModelResolutionMode
  /** Budget for semantic enrichment patches. */
  readonly semanticBudget?: IndexPatchBudget
  /** Existing snapshot used to select semantic files. */
  readonly previousIndex?: ProjectIndexSnapshot
}

interface IndexProjectAstOptions {
  readonly root: string
  readonly configPath?: string
  readonly projectName?: string
}

/**
 * Builds a complete Project Index snapshot for a local project.
 *
 * This is the stable package entry point; lifecycle orchestration lives behind
 * the Project Index Compiler boundary so tests and workers can exercise the same path.
 */
export async function indexProject(options: IndexProjectOptions): Promise<ProjectIndexSnapshot> {
  const result = await compileProjectIndex({
    root: options.root,
    configPath: options.configPath,
    projectName: options.projectName,
    mode: options.resolutionMode,
  })
  return projectIndexSnapshotFromCompilerResult(result)
}

/**
 * Builds an AST/source-only index patch without importing user config modules.
 */
export async function indexProjectAst(options: IndexProjectAstOptions): Promise<IndexPatch> {
  const result = await compileProjectIndex({
    root: options.root,
    configPath: options.configPath,
    projectName: options.projectName,
    mode: 'source-only',
  })
  return astIndexPatchFromCompilerResult(result)
}

/**
 * Builds a semantic enrichment patch from compiler-resolved facts within the configured budget.
 */
export async function indexProjectSemantic(options: IndexProjectOptions): Promise<IndexPatch> {
  const root = resolve(options.root)
  const startedAt = new Date().toISOString()
  const staticSelection = staticDefinitionFileSelection(root)
  const semanticFiles = semanticFilesForIndex(staticSelection.files, options.previousIndex)
  const fileCount = semanticFiles.length
  const basePatch: IndexPatch = {
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
  const fileBudgetPatch = enforceIndexPatchBudget(basePatch, options.semanticBudget, { fileCount })
  if (fileBudgetPatch.status === 'degraded') {
    return { ...fileBudgetPatch, finishedAt: new Date().toISOString() }
  }

  const facts = await semanticIndexFactsCached(root, semanticFiles)
  return enforceIndexPatchBudget(
    {
      ...basePatch,
      facts: {
        ...facts,
        sources: semanticSupportSources(options.previousIndex, facts.sourceRefs),
        sourceGraph: options.previousIndex?.sourceGraph,
      },
      finishedAt: new Date().toISOString(),
    },
    options.semanticBudget,
    { fileCount },
  )
}

function semanticFilesForIndex(
  staticFiles: readonly string[],
  previousIndex: ProjectIndexSnapshot | undefined,
): readonly string[] {
  return [...new Set([...staticFiles, ...(previousIndex?.sources.map((source) => source.file) ?? [])])].sort()
}
