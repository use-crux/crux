import type { ProjectCatalogSnapshot } from '@crux/core/catalog'
import {
  compileProjectCatalog,
  projectCatalogSnapshotFromCompilerResult,
} from '../compiler'
import type { ProjectIndexingSession, ProjectIndexingSessionOptions } from './types'

export type { ProjectIndexingSession, ProjectIndexingSessionMode, ProjectIndexingSessionOptions } from './types'

/**
 * Creates a reusable indexing session object around one normalized project root.
 *
 * The session is now compatibility terminology over the Project Catalog Compiler boundary. Tests
 * and workers can keep using `run()`, while compiler execution returns an immutable result value
 * before projection into the historical snapshot shape.
 */
export function createProjectIndexingSession(options: ProjectIndexingSessionOptions): ProjectIndexingSession {
  return {
    run: () => runProjectIndexingSession(options),
  }
}

/**
 * Runs one full or source-only Project Catalog indexing session and returns the final snapshot.
 */
export async function runProjectIndexingSession(
  options: ProjectIndexingSessionOptions,
): Promise<ProjectCatalogSnapshot> {
  const result = await compileProjectCatalog({
    root: options.root,
    configPath: options.configPath,
    projectName: options.projectName,
    mode: options.mode,
    indexedAt: options.indexedAt,
  })
  return projectCatalogSnapshotFromCompilerResult(result)
}

/**
 * Runs the source-only catalog session used by AST patch generation.
 *
 * This mode parses authored source but does not import user config modules, which keeps
 * source-only indexing safe for projects whose config has runtime side effects.
 */
export async function runSourceOnlyProjectIndexingSession(
  options: Omit<ProjectIndexingSessionOptions, 'mode'>,
): Promise<ProjectCatalogSnapshot> {
  return runProjectIndexingSession({ ...options, mode: 'source-only' })
}
