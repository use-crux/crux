/** Traversal-safe paths and source/Case identity for Eval discovery. */

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type * as EvalRunnerCore from '@use-crux/core/eval/internal/runner'
import type { DiscoveredEval } from './eval-discovery'
import type { EvalCaseHydrationOptions, LoadedEvalCase } from './eval-cases'
import { EvalCaseFileError } from './eval-case-errors'

export async function fingerprintEvalDefinition(
  discovered: DiscoveredEval,
  definition: EvalRunnerCore.EvalDefinitionV1,
  cases: readonly LoadedEvalCase[],
  caseFileDependencies: readonly string[],
  options: EvalCaseHydrationOptions,
): Promise<string> {
  const authoredSource = await readFile(
    insideProjectRoot(options.projectRoot, discovered.sourceKey.relativeFile),
    'utf8',
  )
  const source = definition.caseFiles.reduce(
    (normalized, reference, index) =>
      normalized.replaceAll(reference.path, caseFileDependencies[index] ?? reference.path),
    authoredSource,
  )
  const material = {
    source,
    evalId: discovered.id,
    caseFileDependencies,
    cases: cases.map((entry) => ({
      id: entry.id,
      value: options.core.fingerprintEvalValueForInternalUse({
        input: entry.authored.input,
        ...(entry.authored.name !== undefined ? { name: entry.authored.name } : {}),
        ...(entry.authored.call !== undefined ? { call: entry.authored.call } : {}),
        ...(entry.authored.expected !== undefined ? { expected: entry.authored.expected } : {}),
        ...(entry.authored.unvalidatedExpected === true ? { unvalidatedExpected: true } : {}),
        ...(entry.authored.trials !== undefined ? { trials: entry.authored.trials } : {}),
        ...(entry.authored.tags !== undefined ? { tags: entry.authored.tags } : {}),
        ...(entry.authored.skip !== undefined ? { skip: entry.authored.skip } : {}),
        ...(entry.authored.only !== undefined ? { only: entry.authored.only } : {}),
      }),
    })),
    arms: definition.arms,
  }
  return createHash('sha256').update(JSON.stringify(material)).digest('hex')
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

export function insideProjectRoot(projectRoot: string, path: string): string {
  const root = resolve(projectRoot)
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path)
  const fromRoot = relative(root, absolute)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new EvalCaseFileError(path, 'path must stay inside the project root')
  }
  return absolute
}

export function projectRelative(projectRoot: string, path: string): string {
  return relative(resolve(projectRoot), path).replaceAll('\\', '/')
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
