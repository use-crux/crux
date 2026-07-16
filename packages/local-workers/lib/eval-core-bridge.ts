/** Load the project's Core Eval coordinator contract without a second Core copy. */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { pathToFileURL } from 'node:url'
import type * as EvalRunnerModule from '@use-crux/core/eval/internal/runner'

const SUPPORTED_PROTOCOLS = [1] as const

export type EvalRunnerCore = typeof EvalRunnerModule
export type EvalNodeCore = typeof import('@use-crux/core/eval/node')

/** Structured worker/Core skew failure emitted before discovery. */
export class EvalRunnerProtocolMismatchError extends Error {
  override readonly name = 'EvalRunnerProtocolMismatchError'
  readonly code = 'protocol-mismatch'

  constructor(
    readonly core: number | 'pre-versioning',
    readonly worker: readonly number[] = SUPPORTED_PROTOCOLS,
  ) {
    super(`@use-crux/core Eval runner protocol ${String(core)} is unsupported; align @use-crux/core and Crux Local. Supported protocols: ${worker.join(', ')}.`)
  }
}

/** Verify the private tooling protocol before importing project Eval files. */
export function assertEvalRunnerProtocol(value: unknown): asserts value is EvalRunnerCore {
  const protocol = value !== null && typeof value === 'object' && 'EVAL_RUNNER_PROTOCOL' in value
    ? value.EVAL_RUNNER_PROTOCOL
    : 'pre-versioning'
  if (typeof protocol !== 'number' || !SUPPORTED_PROTOCOLS.includes(protocol as 1)) {
    throw new EvalRunnerProtocolMismatchError(typeof protocol === 'number' ? protocol : 'pre-versioning')
  }
}

/** Resolve and import the project-local internal Eval runner facade. */
export async function loadEvalRunnerCore(projectRoot: string): Promise<EvalRunnerCore> {
	return (await loadCoreExport(projectRoot, './eval/internal/runner', true)) as EvalRunnerCore
}

/** Resolve the project-local Node stores used by CLI coordination. */
export async function loadEvalNodeCore(projectRoot: string): Promise<EvalNodeCore> {
	return (await loadCoreExport(projectRoot, './eval/node', false)) as EvalNodeCore
}

async function loadCoreExport(
  projectRoot: string,
  exportName: './eval/internal/runner' | './eval/node',
  checkProtocol: boolean,
): Promise<unknown> {
  const packageDir = findPackageDir(projectRoot, '@use-crux/core')
  if (packageDir === undefined) {
    throw new Error(`@use-crux/core is not resolvable from ${projectRoot}; add it to the project before running Evals.`)
  }
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
    readonly exports?: Readonly<Record<string, unknown>>
  }
  const target = exportTarget(manifest.exports?.[exportName])
  if (target === undefined) {
    throw new Error(`@use-crux/core does not export ${exportName}; align @use-crux/core and Crux Local versions.`)
  }
  const imported = await import(pathToFileURL(join(packageDir, target)).href)
  if (checkProtocol) assertEvalRunnerProtocol(imported)
  return imported
}

function findPackageDir(start: string, packageName: string): string | undefined {
  let current = start
  const root = parse(current).root
  while (true) {
    const manifest = join(current, 'node_modules', ...packageName.split('/'), 'package.json')
    if (existsSync(manifest)) return dirname(manifest)
    if (current === root) return undefined
    current = dirname(current)
  }
}

function exportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && 'import' in value && typeof value.import === 'string') {
    return value.import
  }
  return undefined
}
