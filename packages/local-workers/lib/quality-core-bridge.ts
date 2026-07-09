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

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { pathToFileURL } from 'node:url'

const SUPPORTED_QUALITY_RUNNER_PROTOCOLS = [1] as const

/** The runner tooling contract, typed as a module instance. */
export type RunnerCore = typeof import('@use-crux/core/quality/internal/runner')

/** The observability contract, loaded from the same project-local core package. */
export type ObservabilityCore = typeof import('@use-crux/core/observability')

let cachedCore: RunnerCore | undefined
let cachedObservabilityCore: ObservabilityCore | undefined

export class QualityRunnerProtocolMismatchError extends Error {
  readonly code = 'protocol-mismatch'
  readonly core: number | 'pre-versioning'
  readonly worker = SUPPORTED_QUALITY_RUNNER_PROTOCOLS

  constructor(core: number | 'pre-versioning') {
    super(
      `@use-crux/core quality runner protocol ${String(core)} is not supported by this local worker; supported protocols: ${SUPPORTED_QUALITY_RUNNER_PROTOCOLS.join(', ')}.`,
    )
    this.name = 'QualityRunnerProtocolMismatchError'
    this.core = core
  }
}

function runnerProtocolOf(value: unknown): number | 'pre-versioning' {
  if (typeof value !== 'object' || value === null || !('QUALITY_RUNNER_PROTOCOL' in value)) {
    return 'pre-versioning'
  }
  const protocol = value.QUALITY_RUNNER_PROTOCOL
  return typeof protocol === 'number' ? protocol : 'pre-versioning'
}

/**
 * Assert that a project-local core runner facade speaks a worker-supported
 * protocol before any collection or execution begins.
 *
 * @throws {@link QualityRunnerProtocolMismatchError} when the project core is
 *   missing the protocol export or exposes an unsupported version.
 */
export function assertQualityRunnerProtocol(core: unknown): asserts core is RunnerCore {
  const protocol = runnerProtocolOf(core)
  if (!SUPPORTED_QUALITY_RUNNER_PROTOCOLS.includes(protocol as (typeof SUPPORTED_QUALITY_RUNNER_PROTOCOLS)[number])) {
    throw new QualityRunnerProtocolMismatchError(protocol)
  }
}

function resolveCoreExport(projectDir: string, exportName: './quality/internal/runner' | './observability'): string {
  const packageDir = findPackageDir(projectDir, '@use-crux/core')
  if (packageDir === undefined) {
    throw new Error(
      `@use-crux/core is not resolvable from ${projectDir} — the quality runner needs the project to depend on @use-crux/core.`,
    )
  }
  const packageJson = readPackageJson(join(packageDir, 'package.json'))
  const target = exportTarget(packageJson, exportName)
  if (target === undefined) {
    throw new Error(`@use-crux/core does not export ${exportName} for ESM import from ${packageDir}.`)
  }
  return join(packageDir, target)
}

function findPackageDir(startDir: string, packageName: string): string | undefined {
  let current = startDir
  const root = parse(current).root
  while (true) {
    const candidate = join(current, 'node_modules', ...packageName.split('/'), 'package.json')
    if (existsSync(candidate)) return dirname(candidate)
    if (current === root) return undefined
    current = dirname(current)
  }
}

interface PackageJsonWithExports {
  exports?: Record<string, unknown>
}

function readPackageJson(path: string): PackageJsonWithExports {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJsonWithExports
}

function exportTarget(packageJson: PackageJsonWithExports, exportName: string): string | undefined {
  const entry = packageJson.exports?.[exportName]
  if (typeof entry === 'string') return entry
  if (typeof entry === 'object' && entry !== null && 'import' in entry && typeof entry.import === 'string') {
    return entry.import
  }
  return undefined
}

/**
 * Resolve and import the project's own `@use-crux/core` runner contract.
 * Cached per process — the worker only ever serves one project.
 *
 * @throws when the project does not depend on `@use-crux/core` — a definition
 *   error (CLI exit 2), not a crash.
 */
export async function loadRunnerCore(projectDir: string): Promise<RunnerCore> {
  if (cachedCore !== undefined) return cachedCore
  const resolved = resolveCoreExport(projectDir, './quality/internal/runner')
  const imported = await import(pathToFileURL(resolved).href)
  assertQualityRunnerProtocol(imported)
  cachedCore = imported
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
  const resolved = resolveCoreExport(projectDir, './observability')
  cachedObservabilityCore = (await import(pathToFileURL(resolved).href)) as ObservabilityCore
  return cachedObservabilityCore
}
