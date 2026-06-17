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
import type { Evaluation, EvaluationManifest } from '@crux/core/quality/internal/runner'
import type { AnyPrompt } from '@crux/core'
import type { RunnerCore } from './quality-core-bridge'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** One discovered evaluation, with its collect-time identity resolved. */
export interface CollectedEvaluation {
  /** Resolved id — explicit from source, or path-derived. */
  id: string
  /** Whether the id was explicit in source (promotion requires explicit). */
  explicitId: boolean
  /** POSIX path relative to the quality root (`''` for prompt-tests). */
  file: string
  /** `'default'`, the named export, or `''` for prompt-tests. */
  exportName: string
  source: 'file' | 'prompt-tests'
  /** The live Evaluation value (collect never executes its task). */
  evaluation: Evaluation
  /** Manifest with the collect-time fields filled in. */
  manifest: EvaluationManifest
}

/** A definition/discovery problem — maps to CLI exit code 2. */
export interface CollectError {
  message: string
  file?: string
}

export interface CollectResult {
  evaluations: CollectedEvaluation[]
  errors: CollectError[]
}

// ─────────────────────────────────────────────────────────────────
// Collection
// ─────────────────────────────────────────────────────────────────

function isEvaluationValue(value: unknown): value is Evaluation {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { _tag?: unknown })._tag === 'CruxEvaluation' &&
    typeof (value as { run?: unknown }).run === 'function'
  )
}

function isThenable(value: unknown): boolean {
  return value !== null && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function'
}

function fillManifest(
  manifest: EvaluationManifest,
  fields: { id: string; explicitId: boolean; file: string; exportName: string },
): EvaluationManifest {
  return { ...manifest, ...fields }
}

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
}): Promise<CollectResult> {
  const evaluations: CollectedEvaluation[] = []
  const errors: CollectError[] = []

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
      errors.push({ message: `Failed to import ${posixFile}: ${describeError(error)}`, file: posixFile })
      continue
    }

    for (const [exportName, value] of Object.entries(moduleExports)) {
      if (isThenable(value)) {
        errors.push({
          message:
            `${posixFile} export '${exportName}' is a Promise — evaluations must be defined synchronously at module ` +
            `top level (async-at-collect). Define the evaluation with evaluate() and load slow resources via dataset() or eval-local helpers.`,
          file: posixFile,
        })
        continue
      }
      if (isEvaluationValue(value)) {
        const explicit = typeof value.id === 'string' && value.id.length > 0 ? value.id : undefined
        const explicitId = explicit !== undefined
        const id = explicit ?? deriveEvaluationId(posixFile, exportName)
        evaluations.push({
          id,
          explicitId,
          file: posixFile,
          exportName,
          source: 'file',
          evaluation: value,
          manifest: fillManifest(value.manifest, { id, explicitId, file: posixFile, exportName }),
        })
      }
    }
  }

  return { evaluations, errors }
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
 * `prompt:<id>` evaluations. Prompts come from the loaded crux config's
 * registry; prompts without tests are skipped. Lowering failures (e.g. a
 * tested prompt without an explicit id) become collect errors.
 *
 * `core` is the PROJECT's `@crux/core` runner contract (see
 * quality-core-bridge) — lowering must happen in the same module instance
 * that defined the prompts.
 */
export function collectPromptTests(prompts: readonly AnyPrompt[], core: RunnerCore): CollectResult {
  const evaluations: CollectedEvaluation[] = []
  const errors: CollectError[] = []
  for (const candidate of prompts) {
    if (!core.hasPromptTests(candidate)) continue
    let evaluation: Evaluation
    try {
      evaluation = core.lowerPromptTests(candidate)
    } catch (error) {
      errors.push({ message: describeError(error) })
      continue
    }
    const id = evaluation.id ?? `prompt:${String(candidate.id)}`
    evaluations.push({
      id,
      explicitId: true,
      file: '',
      exportName: '',
      source: 'prompt-tests',
      evaluation,
      manifest: fillManifest(evaluation.manifest, { id, explicitId: true, file: '', exportName: '' }),
    })
  }
  return { evaluations, errors }
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
