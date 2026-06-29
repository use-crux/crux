/**
 * Run implementation for the Quality runner facade.
 *
 * This module owns selection, filtered-run demotion, setup resolution, engine
 * option construction, and event shaping. Callers pass collected evaluations;
 * engine definitions stay behind the opaque handle.
 *
 * @internal
 * @module
 */

import { join } from 'node:path'
import type { EvaluationManifest } from '../manifest'
import type { Experiment, RunOverrides } from '../experiment'
import type { QualitySourceFrameResolver } from '../source-frame'
import { experimentRecordPath } from './persist'
import { QualityDefinitionError, runEvaluation } from './engine'
import { NotImplementedError } from './errors'
import type { EngineOptions, EngineSetup } from './engine'
import type { EvaluationDefinition } from './definition'
import type {
  QualityCollectedEvaluation,
  QualityEventSink,
  QualityRunInput,
  QualityRunnerEnv,
  QualityRunResult,
} from './runner-types'
import { getQualityEvaluationHandleState } from './runner-types'

/** Tasks whose lowered prompt-test runner needs an ambient `generate` fn. */
const MODEL_BACKED_KINDS = new Set(['prompt', 'agent'])

/** Execute selected evaluations through the engine and emit facade events. */
export async function runQualityEvaluations(env: QualityRunnerEnv, input: QualityRunInput): Promise<QualityRunResult> {
  const emit = env.events
  const selection = selectEvaluations(input.evaluations, input.ids)
  if (selection.unknownId !== undefined) {
    emit?.({
      type: 'error',
      scope: 'execute',
      message: unknownIdMessage(selection.unknownId, input.evaluations),
    })
    emit?.({ type: 'run:done', experiments: [], exitCode: 2 })
    return { exitCode: 2, experimentIds: [], experiments: [] }
  }

  const onlySelected = selection.selected.filter((entry) => entry.manifest.flags.only)
  const narrowedByOnly = onlySelected.length > 0 && onlySelected.length < selection.selected.length
  const toRun = narrowedByOnly ? onlySelected : selection.selected
  const forceFiltered = input.forceFilteredRun === true || narrowedByOnly || (input.cases?.length ?? 0) > 0

  let setup: EngineSetup | undefined
  let setupResolved = false
  const experiments: Experiment<unknown, unknown, string, string>[] = []
  const experimentIds: string[] = []
  let exitCode: 0 | 1 | 2 = 0

  for (const entry of toRun) {
    const evaluationId = entry.id
    emit?.({
      type: 'eval:start',
      evaluationId,
      cells: countPlannedCells(entry.manifest, input.trials),
    })

    let experiment: Experiment<unknown, unknown, string, string>
    try {
      const setupNeeded = shouldResolveSetup(entry)
      if (setupNeeded && !setupResolved) {
        setup = await resolveSetup(env.setup)
        setupResolved = true
      }

      const engineOptions = buildEngineOptions({
        env,
        input,
        entry,
        evaluationId,
        setup: setupNeeded ? setup : undefined,
        forceFiltered,
        emit,
      })
      const handleState = getHandleState(entry)
      experiment = await runEvaluation(handleState.definition, buildOverrides(input), engineOptions)
    } catch (error) {
      if (error instanceof QualityDefinitionError) {
        emit?.({
          type: 'error',
          scope: 'execute',
          message: `${evaluationId}: ${error.message}`,
          ...(error.code !== undefined ? { code: error.code } : {}),
        })
        exitCode = 2
        continue
      }
      if (error instanceof NotImplementedError) {
        emit?.({
          type: 'error',
          scope: 'execute',
          message: `${evaluationId}: ${error.message}`,
        })
        exitCode = 2
        continue
      }
      emit?.({
        type: 'error',
        scope: 'execute',
        message: `${evaluationId}: ${describeError(error)}`,
      })
      exitCode = exitCode === 2 ? 2 : 1
      continue
    }

    experiments.push(experiment)
    experimentIds.push(experiment.experimentId)
    emitEvalDone(env, emit, experiment)
    if (!experiment.passed && exitCode === 0) exitCode = 1
  }

  emit?.({ type: 'run:done', experiments: experimentIds, exitCode })
  return { exitCode, experimentIds, experiments }
}

function buildEngineOptions(input: {
  env: QualityRunnerEnv
  input: QualityRunInput
  entry: QualityCollectedEvaluation
  evaluationId: string
  setup: EngineSetup | undefined
  forceFiltered: boolean
  emit: QualityEventSink | undefined
}): EngineOptions {
  const sourceFrames = normalizeSourceFrames(input.env.sourceFrames)

  return {
    evaluationId: input.evaluationId,
    ...(input.env.qualityId !== undefined ? { qualityId: input.env.qualityId } : {}),
    ...(input.env.dir !== undefined ? { dir: input.env.dir } : {}),
    ...(input.env.persist !== undefined ? { persist: input.env.persist } : {}),
    ...(input.env.redact !== undefined ? { redact: input.env.redact } : {}),
    ...(input.env.rootDir !== undefined ? { rootDir: input.env.rootDir } : {}),
    ...(input.env.defaults !== undefined ? { defaults: input.env.defaults } : {}),
    ...(input.env.cacheDir !== undefined ? { cacheDir: input.env.cacheDir } : {}),
    ...(sourceFrames?.resolver !== undefined ? { sourceFrameResolver: sourceFrames.resolver } : {}),
    ...(sourceFrames?.radius !== undefined ? { sourceFrameRadius: sourceFrames.radius } : {}),
    ...(input.input.experimentLabel !== undefined ? { experimentLabel: input.input.experimentLabel } : {}),
    ...(input.setup !== undefined ? { setup: input.setup } : {}),
    ...(input.forceFiltered ? { forceFilteredRun: true } : {}),
    events: {
      onCellStart: (cell) =>
        input.emit?.({
          type: 'cell:start',
          evaluationId: input.evaluationId,
          ...cell,
        }),
      onCellDone: (cell) =>
        input.emit?.({
          type: 'cell:done',
          evaluationId: input.evaluationId,
          cell,
        }),
    },
  }
}

function buildOverrides(input: QualityRunInput): RunOverrides<string> | undefined {
  const overrides: RunOverrides<string> = {
    ...(input.cases !== undefined && input.cases.length > 0 ? { cases: input.cases } : {}),
    ...(input.variants !== undefined && input.variants.length > 0 ? { variants: input.variants } : {}),
    ...(input.replayMode !== undefined ? { replayMode: input.replayMode } : {}),
    ...(input.reuseOutputs === true ? { reuseOutputs: true } : {}),
    ...(input.trials !== undefined ? { trials: input.trials } : {}),
    ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}),
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined
}

function emitEvalDone(
  env: QualityRunnerEnv,
  emit: QualityEventSink | undefined,
  experiment: Experiment<unknown, unknown, string, string>,
): void {
  const persisted = env.persist !== false
  const dir = env.dir ?? join(env.rootDir ?? process.cwd(), '.crux/quality')
  emit?.({
    type: 'eval:done',
    evaluationId: experiment.evaluationId,
    experimentId: experiment.experimentId,
    configFingerprint: experiment.configFingerprint,
    aggregates: experiment.aggregates,
    gates: experiment.gates,
    filteredRun: experiment.filteredRun,
    ...(experiment.replay.mode !== 'live' ? { replay: experiment.replay } : {}),
    ...(experiment.comparison !== undefined ? { comparison: experiment.comparison } : {}),
    ...(experiment.baselineRef !== undefined ? { baselineRef: experiment.baselineRef } : {}),
    ...(persisted ? { recordPath: experimentRecordPath(dir, experiment.experimentId) } : {}),
  })
}

function normalizeSourceFrames(
  sourceFrames: QualityRunnerEnv['sourceFrames'],
): { resolver: QualitySourceFrameResolver; radius?: number } | undefined {
  if (sourceFrames === undefined) return undefined
  if ('resolveSourceFrame' in sourceFrames) return { resolver: sourceFrames }
  return {
    resolver: sourceFrames.resolver,
    ...(sourceFrames.radius !== undefined ? { radius: sourceFrames.radius } : {}),
  }
}

function shouldResolveSetup(entry: QualityCollectedEvaluation): boolean {
  if (entry.source !== 'prompt-tests') return true
  return MODEL_BACKED_KINDS.has(entry.manifest.task.kind)
}

async function resolveSetup(setup: QualityRunnerEnv['setup']): Promise<EngineSetup | undefined> {
  return typeof setup === 'function' ? setup() : setup
}

function countPlannedCells(manifest: EvaluationManifest, trialsOverride: number | undefined): number {
  let cells = 0
  for (const caseEntry of manifest.cases) {
    cells += trialsOverride ?? caseEntry.trials
  }
  for (const datasetEntry of manifest.datasets) {
    cells += (datasetEntry.caseCount ?? 0) * (trialsOverride ?? manifest.trials)
  }
  return cells
}

interface QualityEvaluationSelection {
  readonly selected: QualityCollectedEvaluation[]
  readonly unknownId?: string
}

function selectEvaluations(
  collected: readonly QualityCollectedEvaluation[],
  ids: readonly string[] | undefined,
): QualityEvaluationSelection {
  if (ids === undefined || ids.length === 0) return { selected: [...collected] }
  const byId = new Map(collected.map((entry) => [entry.id, entry]))
  const selected: QualityCollectedEvaluation[] = []
  for (const id of ids) {
    const entry = byId.get(id)
    if (entry === undefined) return { selected: [], unknownId: id }
    selected.push(entry)
  }
  return { selected }
}

function unknownIdMessage(unknownId: string, collected: readonly QualityCollectedEvaluation[]): string {
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

function getHandleState(entry: QualityCollectedEvaluation): { readonly definition: EvaluationDefinition } {
  const state = getQualityEvaluationHandleState(entry.handle)
  if (entry.handle._tag !== 'CruxQualityEvaluationHandle' || state === undefined) {
    throw new TypeError(`evaluation '${entry.id}' was not collected by createQualityRunner().`)
  }
  return state
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
