/**
 * The Evaluation manifest — serializable structural facts of a definition,
 * computed WITHOUT executing any task.
 *
 * Discovery, `crux quality list --json`, and devtools read manifests to
 * render evaluations before any run. Closures (task bodies, expect callbacks,
 * custom scorers) stay opaque, surfaced as booleans or `'(dynamic)'` names.
 *
 * @module
 */

import type { EvaluationCoverageTargetId, EvaluationDefinition } from './internal/definition'
import { detectTask } from './internal/definition'
import { contentCaseId, slugifyCaseName } from './internal/json'

/**
 * Plain-JSON structural facts of one evaluation definition. Available as
 * `evaluation.manifest` at runtime and emitted by `crux quality list --json`.
 *
 * Schema evolution is additive-only within a `schemaVersion`.
 *
 * The collect-time fields (`id` for path-derived ids, `file`, `exportName`)
 * are filled by the runner when it imports the defining module; a manifest
 * read straight off an `Evaluation` value before collection carries `''`
 * for unresolved fields and the explicit id when one was given.
 *
 * @example
 * ```ts
 * const evaluation = evaluate('support.refunds', { task, data })
 * evaluation.manifest.id            // 'support.refunds'
 * evaluation.manifest.task.kind     // 'prompt'
 * evaluation.manifest.cases.length  // inline cases enumerated, datasets summarized
 * evaluation.manifest.scorers       // [{ name: 'helpful', costClass: 'model' }, …]
 * ```
 */
export interface EvaluationManifest {
  schemaVersion: 1
  /** Resolved id (explicit or path-derived; `''` pre-collection for derived ids). */
  id: string
  /** Whether the id was explicit in source (promotion requires explicit). */
  explicitId: boolean
  /** Defining file relative to the quality root (`''` pre-collection). */
  file: string
  /** `'default'` or the named export (`''` pre-collection). */
  exportName: string
  /** `'file'` for authored evaluations; `'prompt-tests'` for lowered colocated tests. */
  source: 'file' | 'prompt-tests'
  description?: string
  tags: string[]
  /** Project Index definition ids this evaluation is intended to cover. */
  covers?: EvaluationCoverageTargetId[]

  task: {
    kind: 'prompt' | 'flow' | 'agent' | 'retriever' | 'fn'
    /** Source-catalog reference when the task wraps a known primitive. */
    ref?: string
    capabilities: string[]
  }

  /** Inline cases enumerated; dataset cases summarized until first load. */
  cases: Array<{
    caseId: string
    name?: string
    /** Case-level callback present. */
    hasExpect: boolean
    /** Case-level post-score callback present. */
    hasAssert: boolean
    /** Resolved trials (case override or evaluation default). */
    trials: number
    tags: string[]
    skip?: boolean | string
    only?: boolean
  }>
  datasets: Array<{ path: string; caseCount?: number }>

  hasEvaluationExpect: boolean
  hasEvaluationAssert: boolean
  /** Scorer names + cost classes; `'(dynamic)'` for unnamed plain functions. */
  scorers: Array<{ name: string; costClass: 'code' | 'model' }>

  variants: Array<{ name: string; overrideKeys: string[] }>
  baseline?: string
  trials: number
  /** Verbatim gates config (already plain data). */
  gates?: Record<string, unknown>
  replay?: { mode: string; cassette?: string }

  /** `evaluate.only` / `evaluate.skip` flags. */
  flags: { only: boolean; skip: boolean }
}

/**
 * Resolve a case's stable identity: the slug of its explicit `name`, else
 * the content hash of its input (or turns, for input-less multi-turn cases).
 *
 * @internal
 */
export function resolveCaseId(rawCase: { name?: string; input?: unknown; turns?: unknown }): string {
  if (rawCase.name !== undefined && rawCase.name.trim() !== '') return slugifyCaseName(rawCase.name)
  return contentCaseId(rawCase.input !== undefined ? rawCase.input : { turns: rawCase.turns })
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry)
    Object.freeze(value)
  }
  return value
}

/**
 * Build the manifest for a normalized definition. Pure data in, pure data
 * out — no task execution, no scorer invocation (factories were already
 * resolved at definition time).
 *
 * @internal The public read surface is `evaluation.manifest`.
 */
export function buildManifest(definition: EvaluationDefinition): EvaluationManifest {
  const task = detectTask(definition.task)
  const replayMode = definition.replay?.mode
  const cassetteRef = definition.replay?.cassette
  const cassetteName = typeof cassetteRef === 'string' ? cassetteRef : cassetteRef?.name

  const manifest: EvaluationManifest = {
    schemaVersion: 1,
    id: definition.id ?? '',
    explicitId: definition.id !== undefined,
    file: '',
    exportName: '',
    source: definition.source,
    ...(definition.description !== undefined ? { description: definition.description } : {}),
    tags: [...definition.tags],
    ...(definition.covers.length > 0 ? { covers: [...definition.covers] } : {}),
    task: {
      kind: task.kind,
      ...(task.ref !== undefined ? { ref: task.ref } : {}),
      capabilities: [...task.capabilities],
    },
    cases: definition.cases.map((rawCase) => ({
      caseId: resolveCaseId(rawCase),
      ...(rawCase.name !== undefined ? { name: rawCase.name } : {}),
      hasExpect: typeof rawCase.expect === 'function',
      hasAssert: typeof rawCase.assert === 'function',
      trials: rawCase.trials ?? definition.trials ?? 1,
      tags: [...(rawCase.tags ?? [])],
      ...(rawCase.skip !== undefined ? { skip: rawCase.skip } : {}),
      ...(rawCase.only !== undefined ? { only: rawCase.only } : {}),
    })),
    datasets: definition.datasets.map((ds) => ({ path: ds.path })),
    hasEvaluationExpect: typeof definition.expect === 'function',
    hasEvaluationAssert: typeof definition.assert === 'function',
    scorers: definition.scorers.map((scorer) => ({
      name: scorer.scorerName ?? '(dynamic)',
      costClass: scorer.costClass ?? 'code',
    })),
    variants: Object.entries(definition.variants).map(([name, overrides]) => ({
      name,
      overrideKeys: Object.keys(overrides),
    })),
    ...(definition.baseline !== undefined ? { baseline: definition.baseline } : {}),
    trials: definition.trials ?? 1,
    ...(definition.gates !== undefined ? { gates: definition.gates as Record<string, unknown> } : {}),
    ...(replayMode !== undefined
      ? { replay: { mode: replayMode, ...(cassetteName !== undefined ? { cassette: cassetteName } : {}) } }
      : {}),
    flags: { only: definition.flags.only, skip: definition.flags.skip },
  }
  return deepFreeze(manifest)
}
