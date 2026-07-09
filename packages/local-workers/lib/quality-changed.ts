/**
 * Changed-source selection for `crux quality run --changed-since`.
 *
 * The worker can prove evaluation-file matches from collected manifests. When
 * an evaluation depends on `covers` and no definition-source map is available,
 * it fails open so CI never under-runs a potentially affected eval.
 *
 * @module
 */

import { execFileSync } from 'node:child_process'
import type { CollectedEvaluation } from './quality-collect'

export interface ChangedEvaluationSelection {
  /** Evaluation ids to run. Empty means no affected evaluations. */
  ids: readonly string[]
  /** Present when source ownership was incomplete and callers must run all. */
  failOpenReason?: string
}

/** Resolve changed files from git and map them to collected evaluations. */
export function selectChangedEvaluations(input: {
  projectRoot: string
  gitRef: string
  collected: readonly CollectedEvaluation[]
  ids?: readonly string[]
}): ChangedEvaluationSelection {
  return selectChangedEvaluationsForFiles({
    changedFiles: changedFilesSince(input.projectRoot, input.gitRef),
    collected: input.collected,
    ...(input.ids !== undefined ? { ids: input.ids } : {}),
  })
}

/** Map known changed files to collected evaluations. */
export function selectChangedEvaluationsForFiles(input: {
  changedFiles: readonly string[]
  collected: readonly CollectedEvaluation[]
  ids?: readonly string[]
}): ChangedEvaluationSelection {
  const candidates = input.ids === undefined || input.ids.length === 0
    ? input.collected
    : input.collected.filter((entry) => input.ids?.includes(entry.id))
  const changed = new Set(input.changedFiles.map(normalizePath))
  const matched = candidates.filter((entry) => entry.file !== '' && changed.has(normalizePath(entry.file)))
  const hasUnmappedCoverage = candidates.some((entry) => {
    if ((entry.manifest.covers?.length ?? 0) === 0) return false
    return entry.file === '' || !changed.has(normalizePath(entry.file))
  })
  if (hasUnmappedCoverage) {
    return {
      ids: candidates.map((entry) => entry.id),
      failOpenReason: '--changed-since could not prove covered definition source files; running all selected evaluations.',
    }
  }
  return { ids: matched.map((entry) => entry.id) }
}

function changedFilesSince(projectRoot: string, gitRef: string): readonly string[] {
  try {
    const out = execFileSync('git', ['diff', '--name-only', gitRef], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return out
      .split(/\r?\n/u)
      .map((line) => normalizePath(line.trim()))
      .filter((line) => line.length > 0)
  } catch (error) {
    throw new Error(`--changed-since could not run git diff against '${gitRef}': ${error instanceof Error ? error.message : String(error)}`)
  }
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//u, '')
}
