/**
 * The single seam through which the quality worker reaches `@crux/core`.
 *
 * The worker ships as a self-contained bundle extracted to a cache
 * directory; bundling `@crux/core` into it would create a SECOND core
 * instance with its own internal symbols and observability globals — the
 * project's eval files import core from their own node_modules, and the two
 * instances cannot see each other's Evaluations or trace spans (the dual
 * package hazard). So the worker never bundles core: it resolves
 * `@crux/core/quality/internal/runner` FROM THE PROJECT at runtime, sharing
 * one module instance with the user's code.
 *
 * @module
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The runner tooling contract, typed as a module instance. */
export type RunnerCore = typeof import('@crux/core/quality/internal/runner')

let cachedCore: RunnerCore | undefined

/**
 * Resolve and import the project's own `@crux/core` runner contract.
 * Cached per process — the worker only ever serves one project.
 *
 * @throws when the project does not depend on `@crux/core` — a definition
 *   error (CLI exit 2), not a crash.
 */
export async function loadRunnerCore(projectDir: string): Promise<RunnerCore> {
  if (cachedCore !== undefined) return cachedCore
  const projectRequire = createRequire(join(projectDir, 'package.json'))
  let resolved: string
  try {
    resolved = projectRequire.resolve('@crux/core/quality/internal/runner')
  } catch {
    throw new Error(
      `@crux/core is not resolvable from ${projectDir} — the quality runner needs the project to depend on @crux/core.`,
    )
  }
  cachedCore = (await import(pathToFileURL(resolved).href)) as RunnerCore
  return cachedCore
}
