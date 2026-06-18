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
import {
  measureSemanticTiming,
  measureSemanticTimingAsync,
  type SemanticIndexInstrumentation,
} from './semantic/instrumentation'
import { degradedSemanticPatch, semanticFailureDiagnostic } from './semantic/patch'
import { semanticBudgetWithDefaults, semanticPreflight } from './semantic/preflight'
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
  /** Optional timing hook for semantic indexing benchmarks and worker diagnostics. */
  readonly semanticInstrumentation?: SemanticIndexInstrumentation
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
  const semanticSelection = measureSemanticTiming(options.semanticInstrumentation, 'semantic.selection', () => {
    const staticSelection = staticDefinitionFileSelection(root)
    return semanticFilesForIndex(staticSelection.files, options.previousIndex)
  })
  const semanticFiles = semanticSelection.files
  const semanticBudget = semanticBudgetWithDefaults(options.semanticBudget)
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
  const selectionBudgetPatch = enforceIndexPatchBudget(basePatch, semanticBudget, {
    fileCount: semanticFiles.length,
    previousSourceExpansion: semanticSelection.previousSourceExpansion,
  })
  if (selectionBudgetPatch.status === 'degraded') {
    return { ...selectionBudgetPatch, finishedAt: new Date().toISOString() }
  }

  const preflight = await measureSemanticTimingAsync(options.semanticInstrumentation, 'semantic.preflight', () =>
    semanticPreflight(root, semanticFiles, semanticBudget),
  )
  const preflightUsage = {
    ...preflight.usage,
    previousSourceExpansion: semanticSelection.previousSourceExpansion,
  }
  const fileBudgetPatch = enforceIndexPatchBudget(basePatch, semanticBudget, preflightUsage)
  if (fileBudgetPatch.status === 'degraded') {
    return { ...fileBudgetPatch, finishedAt: new Date().toISOString() }
  }

  let facts: Awaited<ReturnType<typeof semanticIndexFactsCached>>
  try {
    facts = await semanticIndexFactsCached(root, semanticFiles, {
      dependencyClosure: preflight.dependencyClosure,
      instrumentation: options.semanticInstrumentation,
    })
  } catch (error) {
    return degradedSemanticPatch(basePatch, [semanticFailureDiagnostic(error)])
  }
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
    semanticBudget,
    preflightUsage,
  )
}

function semanticFilesForIndex(
  staticFiles: readonly string[],
  previousIndex: ProjectIndexSnapshot | undefined,
): { readonly files: readonly string[]; readonly previousSourceExpansion: number } {
  const staticFileSet = new Set(staticFiles)
  const previousFiles = previousIndex?.sources.map((source) => source.file) ?? []
  const previousExpansion = new Set(previousFiles.filter((file) => !staticFileSet.has(file)))
  return {
    files: [...new Set([...staticFiles, ...previousFiles])].sort(),
    previousSourceExpansion: previousExpansion.size,
  }
}
