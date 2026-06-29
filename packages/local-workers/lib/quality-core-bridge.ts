/**
 * The single seam through which the quality worker reaches `@use-crux/core`.
 *
 * The worker ships as a self-contained bundle extracted to a cache
 * directory; bundling `@use-crux/core` into it would create a SECOND core
 * instance with its own internal symbols and observability globals — the
 * project's eval files import core from their own node_modules, and the two
 * instances cannot see each other's Evaluations or trace spans (the dual
 * package hazard). So the worker never bundles core: it resolves
 * `@use-crux/core/quality/internal/runner` FROM THE PROJECT at runtime, sharing
 * one module instance with the user's code.
 *
 * @module
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The runner tooling contract, typed as a module instance. */
export type RunnerCore = typeof import('@use-crux/core/quality/internal/runner')

/** The observability contract, loaded from the same project-local core package. */
export type ObservabilityCore = typeof import('@use-crux/core/observability')

let cachedCore: RunnerCore | undefined
let cachedObservabilityCore: ObservabilityCore | undefined

/**
 * Resolve and import the project's own `@use-crux/core` runner contract.
 * Cached per process — the worker only ever serves one project.
 *
 * @throws when the project does not depend on `@use-crux/core` — a definition
 *   error (CLI exit 2), not a crash.
 */
export async function loadRunnerCore(projectDir: string): Promise<RunnerCore> {
  if (cachedCore !== undefined) return cachedCore
  const projectRequire = createRequire(join(projectDir, 'package.json'))
  let resolved: string
  try {
    resolved = projectRequire.resolve('@use-crux/core/quality/internal/runner')
  } catch {
    throw new Error(
      `@use-crux/core is not resolvable from ${projectDir} — the quality runner needs the project to depend on @use-crux/core.`,
    )
  }
  cachedCore = (await import(pathToFileURL(resolved).href)) as RunnerCore
  return cachedCore
}

/**
 * Resolve and import the project's own observability facade.
 *
 * Kept separate from the Quality runner facade so runner exports remain
 * operation-level while devtools auto-attach still shares the project's core
 * observability globals.
 */
export async function loadObservabilityCore(projectDir: string): Promise<ObservabilityCore> {
  if (cachedObservabilityCore !== undefined) return cachedObservabilityCore
  const projectRequire = createRequire(join(projectDir, 'package.json'))
  let resolved: string
  try {
    resolved = projectRequire.resolve('@use-crux/core/observability')
  } catch {
    throw new Error(
      `@use-crux/core is not resolvable from ${projectDir} — the quality runner needs the project to depend on @use-crux/core.`,
    )
  }
  cachedObservabilityCore = (await import(pathToFileURL(resolved).href)) as ObservabilityCore
  return cachedObservabilityCore
}
