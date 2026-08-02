import type { IndexDiagnostic, IndexSourceFile, ProjectDefinition, ProjectRelation } from '@use-crux/core/project-index'
import { evalTaskInvalidDiagnostic, moduleImportFailedDiagnostic } from './diagnostics'
import {
  definitionFromAuthoredEval,
  executionArmsFromAuthoredEval,
  type DiscoveredAuthoredEval,
  isAuthoredEval,
} from './evals'
import { codeFilesFromGlobs } from './files'
import { importUserModule, isUserImportTimeoutError, withCruxIndexMode, withUserImportSession } from './imports'
import { sourceStatus } from './sources'

export interface RuntimeDiscoveryResult {
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  failedImportFiles: string[]
  diagnostics: IndexDiagnostic[]
  sources: readonly IndexSourceFile[]
}

const MAX_CONCURRENT_EVAL_IMPORTS = 16

/**
 * Import Eval modules and index their single default inert Eval export.
 */
export async function discoverRuntimeEvalDefinitions(
  root: string,
  patterns: string[],
  sources: readonly IndexSourceFile[],
): Promise<RuntimeDiscoveryResult> {
  const definitions: ProjectDefinition[] = []
  const relations: ProjectRelation[] = []
  const failedImportFiles: string[] = []
  const evalDiagnostics: IndexDiagnostic[] = []

  const evalModules = await withCruxIndexMode(() =>
    withUserImportSession(() => discoverModules(root, patterns, sources), root),
  )
  for (const moduleResult of evalModules) {
    if (!moduleResult.ok) {
      failedImportFiles.push(moduleResult.file)
      continue
    }
    const authoredEvals = Object.entries(moduleResult.exports).filter(
      (entry): entry is [string, DiscoveredAuthoredEval] => isAuthoredEval(entry[1]),
    )
    if (authoredEvals.length === 1 && authoredEvals[0]![0] === 'default') {
      const executionArms = executionArmsFromAuthoredEval(authoredEvals[0]![1])
      const projectDefinition = await definitionFromAuthoredEval(
        root,
        moduleResult.file,
        'default',
        authoredEvals[0]![1],
        executionArms,
      )
      definitions.push(projectDefinition)
      evalDiagnostics.push(
        ...executionArms.flatMap((arm) =>
          arm.status === 'invalid'
            ? [
                evalTaskInvalidDiagnostic({
                  root,
                  file: moduleResult.file,
                  evalId: projectDefinition.name,
                  definitionId: projectDefinition.id,
                  arm: arm.name,
                  code: arm.code,
                  reason: arm.reason,
                }),
              ]
            : [],
        ),
      )
    }
  }

  return {
    definitions,
    relations,
    failedImportFiles,
    diagnostics: [...evalModules.flatMap((moduleResult) => moduleResult.diagnostics), ...evalDiagnostics],
    sources: evalModules.at(-1)?.sources ?? sources,
  }
}

async function discoverModules(
  root: string,
  patterns: string[],
  sources: readonly IndexSourceFile[],
): Promise<
  Array<
    | {
        ok: true
        file: string
        exports: Record<string, unknown>
        diagnostics: readonly IndexDiagnostic[]
        sources: readonly IndexSourceFile[]
      }
    | {
        ok: false
        file: string
        diagnostics: readonly IndexDiagnostic[]
        sources: readonly IndexSourceFile[]
      }
  >
> {
  const files = codeFilesFromGlobs(root, patterns)
  const imported = await mapConcurrently(files, MAX_CONCURRENT_EVAL_IMPORTS, async (file) => {
    try {
      const mod = await importUserModule(file, 4_000)
      return {
        ok: true as const,
        file,
        exports: Object.fromEntries(Object.entries(mod)),
        diagnostics: [] as readonly IndexDiagnostic[],
      }
    } catch (error) {
      if (isUserImportTimeoutError(error)) throw error
      return {
        ok: false as const,
        file,
        diagnostics: [moduleImportFailedDiagnostic(root, file, errorMessage(error))],
      }
    }
  })
  const results: Array<
    | {
        ok: true
        file: string
        exports: Record<string, unknown>
        diagnostics: readonly IndexDiagnostic[]
        sources: readonly IndexSourceFile[]
      }
    | {
        ok: false
        file: string
        diagnostics: readonly IndexDiagnostic[]
        sources: readonly IndexSourceFile[]
      }
  > = []
  let nextSources = sources
  for (const result of imported) {
    nextSources = sourceStatus(nextSources, result.file, result.ok ? 'indexed' : 'error')
    results.push({ ...result, sources: nextSources })
  }
  return results
}

async function mapConcurrently<T, R>(
  values: readonly T[],
  limit: number,
  project: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  let stopped = false
  async function work(): Promise<void> {
    while (!stopped && cursor < values.length) {
      const index = cursor
      cursor += 1
      try {
        results[index] = await project(values[index]!)
      } catch (error) {
        stopped = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => work()))
  return results
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
