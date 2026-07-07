/**
 * Quality collect phase — discovery of `*.eval.ts` evaluations and colocated
 * prompt tests, id derivation, duplicate detection, and manifest emission
 * (spec 03 §2). No task body, expect callback, or scorer ever runs here;
 * collect errors map to CLI exit code 2.
 *
 * @module
 */

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { glob } from 'tinyglobby'
import * as defaultRunnerCore from '@use-crux/core/quality/internal/runner'
import type * as runnerCore from '@use-crux/core/quality/internal/runner'
import type { AnyPrompt } from '@use-crux/core'
import type { RunnerCore } from './quality-core-bridge'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** One discovered evaluation, with its collect-time identity resolved. */
export type CollectedEvaluation = runnerCore.QualityCollectedEvaluation

/** A definition/discovery problem — maps to CLI exit code 2. */
export type CollectError = runnerCore.QualityCollectError

export interface CollectResult {
  evaluations: CollectedEvaluation[]
  errors: CollectError[]
}

// ─────────────────────────────────────────────────────────────────
// Collection
// ─────────────────────────────────────────────────────────────────

/**
 * Glob `include` under `rootDir`, import every match, and scan module
 * exports for Evaluations (`_tag: 'CruxEvaluation'`). Errors (failing
 * imports, thenable exports) are collected, not thrown — the caller maps
 * them to exit code 2.
 */
export async function collectEvaluationFiles(options: {
  rootDir: string
  include: string | readonly string[]
  exclude?: string | readonly string[]
  core?: RunnerCore
  validateDuplicateIds?: boolean
}): Promise<CollectResult> {
  const errors: CollectError[] = []
  const modules: runnerCore.QualityEvaluationModule[] = []
  const core = options.core ?? defaultRunnerCore

  const matches = await glob(options.include as string | string[], {
    cwd: options.rootDir,
    ignore: ['**/node_modules/**', '**/dist/**', ...normalizePatterns(options.exclude)],
    absolute: false,
  })

  const files = [...new Set(matches)].sort()

  for (const file of files) {
    const posixFile = file.replaceAll('\\', '/')
    let moduleExports: Record<string, unknown>
    try {
      moduleExports = (await import(pathToFileURL(resolve(options.rootDir, file)).href)) as Record<string, unknown>
    } catch (error) {
      errors.push({
        message: `Failed to import ${posixFile}: ${describeError(error)}`,
        file: posixFile,
      })
      continue
    }
    modules.push({ file: posixFile, exports: moduleExports })
  }

  const collected = await core.createQualityRunner().collect({
    modules,
    ...(options.validateDuplicateIds !== undefined ? { validateDuplicateIds: options.validateDuplicateIds } : {}),
  })
  return {
    evaluations: [...collected.evaluations],
    errors: [...errors, ...collected.errors],
  }
}

function normalizePatterns(patterns: string | readonly string[] | undefined): string[] {
  if (patterns === undefined) return []
  return typeof patterns === 'string' ? [patterns] : [...patterns]
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Lower colocated `prompt({ tests })` cases (Quality rung 0) into
 * `prompt:<id>` evaluations. Prompts come from Project Model/config-visible
 * exports; prompts without tests are skipped. Lowering failures (e.g. a tested
 * prompt without an explicit id) become collect errors.
 *
 * `core` is the PROJECT's `@use-crux/core` runner contract (see
 * quality-core-bridge) — lowering must happen in the same module instance
 * that defined the prompts.
 */
export async function collectPromptTests(
  prompts: readonly AnyPrompt[],
  core: RunnerCore,
  options: { validateDuplicateIds?: boolean } = {},
): Promise<CollectResult> {
  const collected = await core.createQualityRunner().collect({
    promptCandidates: prompts,
    ...(options.validateDuplicateIds !== undefined ? { validateDuplicateIds: options.validateDuplicateIds } : {}),
  })
  return {
    evaluations: [...collected.evaluations],
    errors: [...collected.errors],
  }
}

/**
 * Duplicate ids across the project are a definition error at collect time
 * (spec 01 §8). Call over the FULL collected set (files + prompt-tests).
 */
export function findDuplicateIdErrors(evaluations: readonly CollectedEvaluation[]): CollectError[] {
  const byId = new Map<string, CollectedEvaluation[]>()
  for (const entry of evaluations) {
    const bucket = byId.get(entry.id)
    if (bucket) bucket.push(entry)
    else byId.set(entry.id, [entry])
  }
  const errors: CollectError[] = []
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue
    const locations = entries.map((entry) => (entry.file === '' ? `prompt:${id}` : `${entry.file}#${entry.exportName}`))
    errors.push({
      message: `Duplicate evaluation id '${id}' defined in: ${locations.join(', ')}. Ids must be unique across the project.`,
      file: entries[0]!.file,
    })
  }
  return errors
}

/**
 * Derive the evaluation id from its file location (spec 01 §8): POSIX
 * relative path from the quality root, eval suffix stripped, `/` → `.`;
 * non-default exports append `#<exportName>`.
 *
 * `evals/support/refunds.eval.ts` → `evals.support.refunds`; a file without
 * an `.eval.*` suffix strips only its final extension.
 */
export function deriveEvaluationId(relFile: string, exportName: string): string {
  const posix = relFile.replaceAll('\\', '/')
  const withoutExt = posix.replace(/\.eval\.[cm]?[jt]sx?$/, '').replace(/\.[cm]?[jt]sx?$/, '')
  const base = withoutExt.replaceAll('/', '.')
  return exportName === 'default' ? base : `${base}#${exportName}`
}
