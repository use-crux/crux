import { resolve } from 'node:path'
import type { ProjectIndexSnapshot, ProjectModelResolutionMode } from '@crux/core/project-index'
import {
  astIndexPatchFromCompilerResult,
  compileProjectIndex,
  projectIndexSnapshotFromCompilerResult,
  runtimeIndexPatchFromCompilerResult,
} from './compiler'
import type { IndexPatch, IndexPatchBudget } from './patches'
import type { SemanticIndexInstrumentation } from './semantic/instrumentation'
import type { SemanticSourceProfile } from './semantic/source-profile'
import { createSemanticIndexService, type SemanticBackendSelection } from './semantic/service'

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
  /** Built-in semantic backend selection for this request. */
  readonly semanticBackend?: SemanticBackendSelection
  /** Existing snapshot used to select semantic files. */
  readonly previousIndex?: ProjectIndexSnapshot
  /** Internal AST/source handoff profile used to avoid duplicate semantic source scanning. */
  readonly semanticSourceProfile?: SemanticSourceProfile
}

interface IndexProjectAstOptions {
  readonly root: string
  readonly configPath?: string
  readonly projectName?: string
}

/** Options for explicit runtime-rich Project Index enrichment. */
export interface IndexProjectRuntimeOptions {
  /** Project root used for runtime-rich evidence collection. */
  readonly root: string
  /** Optional Crux config path, relative to `root` unless already absolute. */
  readonly configPath?: string
  /** Optional project name supplied by an embedding CLI or server. */
  readonly projectName?: string
  /**
   * Source/config/semantic snapshot to enrich.
   *
   * Runtime-rich indexing is modeled as an enrichment pass so callers cannot
   * accidentally execute authored modules while asking for the base index.
   */
  readonly previousIndex: ProjectIndexSnapshot
  /** Budget for runtime evidence patches. */
  readonly runtimeBudget?: IndexPatchBudget
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
 * Builds an explicit runtime-rich enrichment patch.
 *
 * This is the only package-level API that may import authored source modules.
 * Default source/config indexing stays execution-free for project files.
 */
export async function indexProjectRuntime(options: IndexProjectRuntimeOptions): Promise<IndexPatch> {
  const result = await compileProjectIndex({
    root: options.root,
    configPath: options.configPath,
    projectName: options.projectName,
    mode: 'runtime-rich',
  })
  return runtimeIndexPatchFromCompilerResult(result)
}

/**
 * Builds a semantic enrichment patch from compiler-resolved facts within the configured budget.
 */
export async function indexProjectSemantic(options: IndexProjectOptions): Promise<IndexPatch> {
  return createSemanticIndexService().indexProject({
    ...options,
    root: resolve(options.root),
    sourceProfile: options.semanticSourceProfile,
  })
}
