/**
 * Quality execute phase — runs collected evaluations through the core engine
 * and emits the single NDJSON event stream (spec 03 §2). The Go CLI renders
 * the stream; devtools consumes it live.
 *
 * Exit codes (spec 03 §1, binding): `0` all blocking gates passed, `1` a
 * gate/expect failed or a cell errored, `2` definition/discovery error.
 *
 * @module
 */

import { join } from 'node:path'
import type {
  Comparison,
  EngineOptions,
  EngineSetup,
  Experiment,
  ExperimentCell,
  EvaluationManifest,
} from '@crux/core/quality/internal/runner'
import type { ReplayMode, RunOverrides } from '@crux/core/quality'
import type { CollectedEvaluation, CollectError } from './quality-collect'
import type { RunnerCore } from './quality-core-bridge'

// ─────────────────────────────────────────────────────────────────
// Event stream (spec 03 §2 — one stream, no per-kind pipelines)
// ─────────────────────────────────────────────────────────────────

/** The worker ⇄ CLI event stream. Serialized as NDJSON on stdout. */
export type QualityRunEvent =
  | { type: 'collect:done'; evaluations: EvaluationManifest[]; errors: CollectError[] }
  | { type: 'eval:start'; evaluationId: string; cells: number }
  | { type: 'cell:start'; evaluationId: string; caseId: string; caseName?: string; variantName: string; trial: number }
  | { type: 'cell:done'; evaluationId: string; cell: ExperimentCell }
  | {
      type: 'eval:done'
      evaluationId: string
      experimentId: string
      configFingerprint: string
      aggregates: Experiment['aggregates']
      gates: Experiment['gates']
      filteredRun: boolean
      /** Replay provenance (mode, cassette, collapsed trials, staleness), when non-live. */
      replay?: Experiment['replay']
      /** Paired-difference comparison (variant baseline or promoted), when computed. */
      comparison?: Comparison<string>
      /** The committed baseline this run was compared against, when any. */
      baselineRef?: Experiment['baselineRef']
      /** Absolute path of the persisted record, when persistence is on. */
      recordPath?: string
    }
  | {
      type: 'promote:done'
      evaluationId: string
      experimentId: string
      baselineId: string
      /** Absolute path of the committed baseline record. */
      path: string
      variantName?: string
      /** Present when the evaluation id was pinned at promote time: the one-line source change to make. */
      pinHint?: string
    }
  | { type: 'run:done'; experiments: string[]; exitCode: 0 | 1 | 2 }
  | { type: 'error'; scope: 'collect' | 'execute' | 'promote'; message: string; file?: string; line?: number }

// ─────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────

export interface ExecuteOptions {
  /** The project's `@crux/core` runner contract (quality-core-bridge). */
  core: RunnerCore
  collected: readonly CollectedEvaluation[]
  /** Evaluation ids to run (exit 2 on unknown, with nearest-match hint). */
  ids?: readonly string[]
  /** Case id/name filters (glob `*`), forwarded to the engine. */
  cases?: readonly string[]
  /** Variant subset; excluding the baseline variant demotes gates (spec 03 §4). */
  variants?: readonly string[]
  /** Replay mode override (non-live modes land in phase 5). */
  replayMode?: ReplayMode
  /** Re-score cached outputs without executing tasks (watch cache). */
  reuseOutputs?: boolean
  /** Trials override for this run. */
  trials?: number
  /** Grouping label stored on the records. */
  experimentLabel?: string
  /** Cap on parallel cells per evaluation. */
  concurrency?: number
  engine: {
    qualityId?: string
    dir?: string
    persist?: boolean
    redact?: readonly string[]
    rootDir?: string
    /** Project-config run defaults (`quality.defaults`), weakest in the resolution order. */
    defaults?: { trials?: number; concurrency?: number; timeoutMs?: number; replay?: ReplayMode }
    /** Output-cache root (watch/--rescore, spec 03 §5). */
    cacheDir?: string
    /** Lazy ambient-provider resolution — called at most once per run. */
    resolveSetup?: () => Promise<EngineSetup | undefined>
  }
  emit: (event: QualityRunEvent) => void
}

export interface ExecuteResult {
  exitCode: 0 | 1 | 2
  experimentIds: string[]
}

// ─────────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────────

/** Tasks whose engine runner needs an ambient `generate` fn. */
const MODEL_BACKED_KINDS = new Set(['prompt', 'agent'])

/**
 * Execute the selected evaluations sequentially (cells inside an evaluation
 * run concurrently in the engine), emitting the live event stream. Never
 * throws for run outcomes — everything lands in the exit code.
 */
export async function executeEvaluations(options: ExecuteOptions): Promise<ExecuteResult> {
  const { core, collected, emit } = options

  const selection = selectEvaluations(collected, options.ids)
  if (selection.unknownId !== undefined) {
    emit({
      type: 'error',
      scope: 'execute',
      message: unknownIdMessage(selection.unknownId, collected),
    })
    emit({ type: 'run:done', experiments: [], exitCode: 2 })
    return { exitCode: 2, experimentIds: [] }
  }

  // evaluate.only narrows the run set — and demotes gates project-wide when
  // it actually narrowed anything (spec 03 §4). Id selection does NOT demote:
  // a full evaluation run by id keeps its honest case population.
  const onlySelected = selection.selected.filter((entry) => entry.manifest.flags.only)
  const narrowedByOnly = onlySelected.length > 0 && onlySelected.length < selection.selected.length
  const toRun = narrowedByOnly ? onlySelected : selection.selected
  const forceFiltered = narrowedByOnly || (options.cases?.length ?? 0) > 0

  let setup: EngineSetup | undefined
  let setupResolved = false
  const needsSetup = toRun.some((entry) => MODEL_BACKED_KINDS.has(entry.manifest.task.kind))

  const experimentIds: string[] = []
  let exitCode: 0 | 1 | 2 = 0

  for (const entry of toRun) {
    if (needsSetup && !setupResolved && options.engine.resolveSetup) {
      setup = await options.engine.resolveSetup()
      setupResolved = true
    }

    const evaluationId = entry.id
    const definition = core.getEvaluationDefinition(entry.evaluation)
    const cellCount = countPlannedCells(entry.manifest, options.trials)
    emit({ type: 'eval:start', evaluationId, cells: cellCount })

    const engineOptions: EngineOptions = {
      evaluationId,
      ...(options.engine.qualityId !== undefined ? { qualityId: options.engine.qualityId } : {}),
      ...(options.engine.dir !== undefined ? { dir: options.engine.dir } : {}),
      ...(options.engine.persist !== undefined ? { persist: options.engine.persist } : {}),
      ...(options.engine.redact !== undefined ? { redact: options.engine.redact } : {}),
      ...(options.engine.rootDir !== undefined ? { rootDir: options.engine.rootDir } : {}),
      ...(options.engine.defaults !== undefined ? { defaults: options.engine.defaults } : {}),
      ...(options.engine.cacheDir !== undefined ? { cacheDir: options.engine.cacheDir } : {}),
      ...(options.experimentLabel !== undefined ? { experimentLabel: options.experimentLabel } : {}),
      ...(setup !== undefined ? { setup } : {}),
      ...(forceFiltered ? { forceFilteredRun: true } : {}),
      events: {
        onCellStart: (cell) => emit({ type: 'cell:start', evaluationId, ...cell }),
        onCellDone: (cell) => emit({ type: 'cell:done', evaluationId, cell }),
      },
    }

    let experiment: Experiment<unknown, unknown, string, string>
    try {
      experiment = await core.runEvaluation(definition, buildOverrides(options), engineOptions)
    } catch (error) {
      if (error instanceof core.QualityDefinitionError) {
        emit({ type: 'error', scope: 'execute', message: `${evaluationId}: ${error.message}` })
        exitCode = 2
        continue
      }
      if (error instanceof core.NotImplementedError) {
        emit({ type: 'error', scope: 'execute', message: `${evaluationId}: ${error.message}` })
        exitCode = 2
        continue
      }
      emit({ type: 'error', scope: 'execute', message: `${evaluationId}: ${describeError(error)}` })
      exitCode = exitCode === 2 ? 2 : 1
      continue
    }

    experimentIds.push(experiment.experimentId)
    const persisted = options.engine.persist !== false
    const dir = options.engine.dir ?? join(options.engine.rootDir ?? process.cwd(), '.crux/quality')
    emit({
      type: 'eval:done',
      evaluationId,
      experimentId: experiment.experimentId,
      configFingerprint: experiment.configFingerprint,
      aggregates: experiment.aggregates,
      gates: experiment.gates,
      filteredRun: experiment.filteredRun,
      ...(experiment.replay.mode !== 'live' ? { replay: experiment.replay } : {}),
      ...(experiment.comparison !== undefined ? { comparison: experiment.comparison } : {}),
      ...(experiment.baselineRef !== undefined ? { baselineRef: experiment.baselineRef } : {}),
      ...(persisted ? { recordPath: core.experimentRecordPath(dir, experiment.experimentId) } : {}),
    })

    if (!experiment.passed && exitCode === 0) exitCode = 1
  }

  emit({ type: 'run:done', experiments: experimentIds, exitCode })
  return { exitCode, experimentIds }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function buildOverrides(options: ExecuteOptions): RunOverrides<string> | undefined {
  const overrides: RunOverrides<string> = {
    ...(options.cases !== undefined && options.cases.length > 0 ? { cases: options.cases } : {}),
    ...(options.variants !== undefined && options.variants.length > 0 ? { variants: options.variants } : {}),
    ...(options.replayMode !== undefined ? { replayMode: options.replayMode } : {}),
    ...(options.reuseOutputs === true ? { reuseOutputs: true } : {}),
    ...(options.trials !== undefined ? { trials: options.trials } : {}),
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined
}

function selectEvaluations(
  collected: readonly CollectedEvaluation[],
  ids: readonly string[] | undefined,
): { selected: CollectedEvaluation[]; unknownId?: string } {
  if (ids === undefined || ids.length === 0) return { selected: [...collected] }
  const byId = new Map(collected.map((entry) => [entry.id, entry]))
  const selected: CollectedEvaluation[] = []
  for (const id of ids) {
    const entry = byId.get(id)
    if (entry === undefined) return { selected: [], unknownId: id }
    selected.push(entry)
  }
  return { selected }
}

function unknownIdMessage(unknownId: string, collected: readonly CollectedEvaluation[]): string {
  const nearest = nearestMatch(
    unknownId,
    collected.map((entry) => entry.id),
  )
  const hint = nearest === undefined ? '' : ` Did you mean '${nearest}'?`
  return `Unknown evaluation id '${unknownId}'.${hint}`
}

function nearestMatch(needle: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const distance = levenshtein(needle, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  // Only suggest plausible typos, not arbitrary ids.
  return bestDistance <= Math.max(3, Math.floor(needle.length / 3)) ? best : undefined
}

function levenshtein(a: string, b: string): number {
  const previous = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) previous[j] = j
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]!
    previous[0] = i
    for (let j = 1; j <= b.length; j++) {
      const insertOrDelete = Math.min(previous[j]!, previous[j - 1]!) + 1
      const substitute = diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      diagonal = previous[j]!
      previous[j] = Math.min(insertOrDelete, substitute)
    }
  }
  return previous[b.length]!
}

function countPlannedCells(manifest: EvaluationManifest, trialsOverride: number | undefined): number {
  let cells = 0
  for (const caseEntry of manifest.cases) {
    cells += trialsOverride ?? caseEntry.trials
  }
  // Dataset cases are unknown until load — count what the manifest knows.
  for (const datasetEntry of manifest.datasets) {
    cells += (datasetEntry.caseCount ?? 0) * (trialsOverride ?? manifest.trials)
  }
  return cells
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
