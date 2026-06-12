/**
 * The Quality execution engine — `evaluation.run()` end-to-end for the
 * single-variant case (Phase 2 scope): matrix execution (cases × trials),
 * trace-backed signals, honest assertions, scorer execution, aggregation,
 * gate evaluation, and persistence.
 *
 * Later phases extend this engine in place: variant matrices and paired
 * comparison (Phase 4), cassette replay (Phase 5). Declaring those surfaces
 * today throws `NotImplementedError` rather than silently ignoring them.
 *
 * @internal Not exported from `@crux/core/quality` — engine plumbing only.
 * @module
 */

import { readFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { readFileSync } from 'node:fs'

import type { AnyPrompt, TokenUsage } from '../../types'
import type { AnyAgent } from '../../agent/agent'
import type { FlowHandle } from '../../flow/types'
import type { Retriever, RetrieveOptions } from '../../retrieval'
import { observe } from '../../observability'

import type { CaseContext } from '../expect'
import { UncapturedSignalError } from '../expect'
import type {
  CellAssertionFailure,
  CellScore,
  Experiment,
  ExperimentCell,
  RunOverrides,
  ScoreAggregate,
  VariantAggregate,
} from '../experiment'
import type { GateResult, Gates } from '../gates'
import type { EvaluationManifest } from '../manifest'
import { resolveCaseId } from '../manifest'
import { DATASET_INTERNAL, type DatasetInternal } from '../dataset'
import { TARGET_INTERNAL, type AnyTarget, type Capability, type GenerateFn, type TargetInternal } from '../target'
import type { StandardSchemaV1 } from '../standard-schema'
import type { EvaluationDefinition, RawCase, RawDataset } from './definition'
import { detectTask, type DetectedTask } from './definition'
import { notImplemented } from './errors'
import { canonicalJson, sha256Hex } from './json'
import { applyRedaction, truncateOutput } from './redact'
import { persistExperiment } from './persist'
import {
  createAssertionRecorder,
  createRuntimeBoundExpect,
  createStepAccessor,
  AssertionFailedError,
} from './expect-runtime'
import { emptyCellSignals, extractCellSignals, installSignalCapture, type CellSignals } from './signals'
import { ulid } from './ulid'

// ─────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────

/**
 * A definition problem the harness author must fix (CLI exit code 2):
 * missing generate fn for a model-backed task, dataset validation failure,
 * unknown filter names, malformed rows.
 *
 * @internal
 */
export class QualityDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QualityDefinitionError'
  }
}

// ─────────────────────────────────────────────────────────────────
// Engine options
// ─────────────────────────────────────────────────────────────────

/** Ambient providers normally supplied by project config `quality.setup()`. @internal */
export interface EngineSetup {
  generate?: GenerateFn
  model?: unknown
  models?: Record<string, unknown>
  judgeModel?: unknown
}

/** Options the collector/CLI (Phase 3) threads into the engine. @internal */
export interface EngineOptions {
  /** Resolved evaluation id; defaults to the definition's explicit id, else `''`. */
  evaluationId?: string
  /** Workbench id; defaults to the nearest package.json name, else `'quality'`. */
  qualityId?: string
  /** Persistence root. Default `'.crux/quality'`. */
  dir?: string
  /** Write the record to disk. Default `true`. */
  persist?: boolean
  /** Dot-path redaction config (always-on defaults still apply). */
  redact?: readonly string[]
  /** Grouping label (CLI `--experiment <label>`). */
  experimentLabel?: string
  /** Ambient execution providers (project config in Phase 3; injectable in tests). */
  setup?: EngineSetup
  /** Root for dataset path resolution. Default `process.cwd()`. */
  rootDir?: string
  /**
   * Project-config run defaults (`quality.defaults`). Weakest in the
   * resolution order: CLI overrides > evaluation declaration > these > the
   * engine's built-ins (trials 1, concurrency 5, timeout 60s).
   */
  defaults?: { trials?: number; concurrency?: number; timeoutMs?: number }
  /**
   * Force `filteredRun: true` on the record even when no case-level filter
   * applied inside this evaluation — used when the surrounding RUN was
   * narrowed (`evaluate.only`, CLI id filters), which demotes gates to
   * informational across the whole invocation (spec 03 §4).
   */
  forceFilteredRun?: boolean
  /**
   * Cell lifecycle callbacks for the runner's live event stream (spec 03
   * §2). `onCellStart` fires only for executed cells; `onCellDone` fires for
   * every cell, including skipped ones.
   */
  events?: {
    onCellStart?: (cell: { caseId: string; caseName?: string; variantName: string; trial: number }) => void
    onCellDone?: (cell: ExperimentCell<unknown, unknown>) => void
  }
}

// ─────────────────────────────────────────────────────────────────
// Phase boundary validation
// ─────────────────────────────────────────────────────────────────

function assertPhaseBoundaries(definition: EvaluationDefinition, overrides: RunOverrides<string> | undefined): void {
  if (Object.keys(definition.variants).length > 0 || (overrides?.variants?.length ?? 0) > 0) {
    notImplemented('phase 4', 'variant execution and comparison')
  }
  const scoreGates = definition.gates?.scores
  if (scoreGates !== undefined) {
    for (const gate of Object.values(scoreGates)) {
      if (gate?.minDeltaVsBaseline !== undefined) {
        notImplemented('phase 4', 'gates.scores.*.minDeltaVsBaseline (baseline comparison)')
      }
    }
  }
  const replayMode = overrides?.replayMode ?? definition.replay?.mode
  if (replayMode !== undefined && replayMode !== 'live') {
    notImplemented('phase 5', `replay mode '${replayMode}'`)
  }
  if (overrides?.reuseOutputs === true) {
    notImplemented('phase 3', 'reuseOutputs (re-score from the output cache)')
  }
}

// ─────────────────────────────────────────────────────────────────
// Data resolution (inline cases + datasets)
// ─────────────────────────────────────────────────────────────────

interface ResolvedCase {
  caseId: string
  raw: RawCase
}

async function validateRow(schema: StandardSchemaV1, value: unknown, where: string): Promise<unknown> {
  const result = await schema['~standard'].validate(value)
  if (result.issues !== undefined) {
    throw new QualityDefinitionError(
      `${where}: row failed schema validation: ${result.issues.map((issue) => issue.message).join('; ')}`,
    )
  }
  return result.value
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) return []
  const headers = lines[0]!.split(',').map((header) => header.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((cell) => cell.trim())
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? ''
    })
    return row
  })
}

async function loadDataset(dataset: RawDataset, rootDir: string): Promise<RawCase[]> {
  const internal = (dataset as { [DATASET_INTERNAL]?: DatasetInternal })[DATASET_INTERNAL]
  if (internal === undefined) {
    throw new QualityDefinitionError(`dataset '${dataset.path}': missing internal schemas (not built by dataset()).`)
  }
  const path = isAbsolute(dataset.path) ? dataset.path : join(rootDir, dataset.path)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    throw new QualityDefinitionError(
      `dataset '${dataset.path}': cannot read file at ${path} (${error instanceof Error ? error.message : String(error)}).`,
    )
  }

  let rows: unknown[]
  if (dataset.path.endsWith('.jsonl')) {
    rows = text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as unknown)
  } else if (dataset.path.endsWith('.csv')) {
    rows = parseCsv(text)
  } else {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) {
      throw new QualityDefinitionError(`dataset '${dataset.path}': JSON datasets must be an array of rows.`)
    }
    rows = parsed
  }

  const cases: RawCase[] = []
  for (const [index, row] of rows.entries()) {
    if (row === null || typeof row !== 'object') {
      throw new QualityDefinitionError(`dataset '${dataset.path}': row ${index} is not an object.`)
    }
    const record = row as Record<string, unknown>
    if (typeof record.expect === 'function') {
      throw new QualityDefinitionError(
        `dataset '${dataset.path}': row ${index} carries an expect callback — dataset rows are pure data.`,
      )
    }
    const inputSource = record.input !== undefined ? record.input : record
    const input = await validateRow(internal.input, inputSource, `dataset '${dataset.path}' row ${index}`)
    const expectedSource = record.expected
    const expected =
      internal.expected !== undefined && expectedSource !== undefined
        ? await validateRow(internal.expected, expectedSource, `dataset '${dataset.path}' row ${index} (expected)`)
        : expectedSource
    cases.push({
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      input,
      ...(expected !== undefined ? { expected } : {}),
      ...(typeof record.trials === 'number' ? { trials: record.trials } : {}),
      ...(Array.isArray(record.tags) ? { tags: record.tags as string[] } : {}),
      ...(record.skip !== undefined ? { skip: record.skip as boolean | string } : {}),
      ...(record.only !== undefined ? { only: record.only as boolean } : {}),
    })
  }
  return cases
}

function caseMatchesFilter(resolved: ResolvedCase, filters: readonly string[]): boolean {
  return filters.some((filter) => {
    if (filter.includes('*')) {
      const pattern = new RegExp(`^${filter.split('*').map(escapeRegExp).join('.*')}$`)
      return pattern.test(resolved.caseId) || (resolved.raw.name !== undefined && pattern.test(resolved.raw.name))
    }
    return resolved.caseId === filter || resolved.raw.name === filter
  })
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─────────────────────────────────────────────────────────────────
// Task lifting
// ─────────────────────────────────────────────────────────────────

type TaskRunner = (input: unknown, params: Record<string, unknown>) => Promise<unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** Unwrap an adapter generate result to the task output (engine contract). */
function normalizeGenerateResult(result: unknown, structured: boolean): unknown {
  if (isRecord(result)) {
    if (structured && 'object' in result && result.object !== undefined) return result.object
    if (!structured && 'text' in result && typeof result.text === 'string') return result.text
  }
  return result
}

function requireGenerate(params: Record<string, unknown>, setup: EngineSetup | undefined, kind: string): GenerateFn {
  const generate = (params.generate as GenerateFn | undefined) ?? setup?.generate
  if (typeof generate !== 'function') {
    throw new QualityDefinitionError(
      `${kind} tasks need an adapter generate fn: pass \`params.generate\`, target defaults, or configure quality.setup().`,
    )
  }
  return generate
}

function resolveModel(params: Record<string, unknown>, setup: EngineSetup | undefined): unknown {
  const ref = params.model ?? setup?.model
  if (typeof ref === 'string' && setup?.models !== undefined && ref in setup.models) return setup.models[ref]
  return ref
}

function mockTools(tools: Record<string, unknown> | undefined, mocks: Record<string, unknown> | undefined) {
  if (tools === undefined && mocks === undefined) return undefined
  const merged: Record<string, unknown> = { ...(tools ?? {}) }
  for (const [name, mock] of Object.entries(mocks ?? {})) {
    const original = isRecord(merged[name]) ? (merged[name] as Record<string, unknown>) : {}
    merged[name] = {
      ...original,
      execute: typeof mock === 'function' ? mock : () => mock,
    }
  }
  return merged
}

function createTaskRunner(
  task: unknown,
  detected: DetectedTask,
  setup: EngineSetup | undefined,
): TaskRunner {
  const internal = (task as { [TARGET_INTERNAL]?: TargetInternal })[TARGET_INTERNAL as never] as
    | TargetInternal
    | undefined
  const primitive = internal?.primitive ?? task

  switch (detected.kind) {
    case 'fn': {
      if (internal?.run !== undefined) {
        const run = internal.run as (input: unknown, params: unknown) => unknown
        return async (input, params) => run(input, params)
      }
      const fn = task as (input: unknown, params: unknown) => unknown
      return async (input, params) => fn(input, params)
    }
    case 'prompt': {
      return async (input, params) => {
        const generate = requireGenerate(params, setup, 'prompt')
        const activePrompt = (params.prompt as AnyPrompt | undefined) ?? (primitive as AnyPrompt)
        if (params.prompt !== undefined && (params.prompt as AnyPrompt)._tag !== 'Prompt') {
          throw new QualityDefinitionError('params.prompt must be a Crux prompt.')
        }
        const structured = activePrompt.outputSchema !== undefined
        const opts = {
          input,
          ...(resolveModel(params, setup) !== undefined ? { model: resolveModel(params, setup) } : {}),
          ...(isRecord(params.settings) ? params.settings : {}),
        }
        const result = await generate(activePrompt as never, opts as never)
        return normalizeGenerateResult(result, structured)
      }
    }
    case 'agent': {
      return async (input, params) => {
        const generate = requireGenerate(params, setup, 'agent')
        const agentTask = primitive as AnyAgent
        const structured = agentTask.prompt.outputSchema !== undefined
        const model = resolveModel(params, setup) ?? agentTask.model
        const tools = mockTools(
          agentTask.tools as Record<string, unknown> | undefined,
          params.tools as Record<string, unknown> | undefined,
        )
        const opts = {
          input,
          ...(model !== undefined ? { model } : {}),
          ...(tools !== undefined ? { tools } : {}),
          maxSteps: typeof params.maxToolSteps === 'number' ? params.maxToolSteps : 15,
          ...(isRecord(params.settings) ? params.settings : {}),
        }
        const result = await generate(agentTask.prompt as never, opts as never)
        return normalizeGenerateResult(result, structured)
      }
    }
    case 'flow': {
      return async (input) => {
        const handle = primitive as FlowHandle<unknown, unknown>
        const result = await handle.run({ input })
        if (result.status !== 'completed') {
          throw new Error(`flow '${handle.name}' did not complete: status '${result.status}'.`)
        }
        return result.output
      }
    }
    case 'retriever': {
      return async (input, params) => {
        const retrieverTask = primitive as Retriever
        const query =
          internal?.query !== undefined
            ? (internal.query as (input: unknown) => string)(input)
            : isRecord(input) && typeof input.query === 'string'
              ? input.query
              : undefined
        if (typeof query !== 'string') {
          throw new QualityDefinitionError(
            'retriever tasks need a string query: case inputs must be `{ query }` or the target must declare a `query` mapper.',
          )
        }
        const options = {
          ...(internal?.options ?? {}),
          ...(isRecord(params.options) ? params.options : {}),
        } as RetrieveOptions
        return retrieverTask.retrieve(query, options)
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Statistics
// ─────────────────────────────────────────────────────────────────

function meanOf(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function semOf(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = meanOf(values)
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance / values.length)
}

function p95Of(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)
  return sorted[Math.max(0, index)]!
}

// ─────────────────────────────────────────────────────────────────
// Fingerprints
// ─────────────────────────────────────────────────────────────────

function configFingerprintOf(definition: EvaluationDefinition): string {
  return sha256Hex(
    canonicalJson({
      cases: definition.cases.map((rawCase) => ({
        caseId: resolveCaseId(rawCase),
        expected: rawCase.expected,
        trials: rawCase.trials,
        skip: rawCase.skip,
        only: rawCase.only,
      })),
      datasets: definition.datasets.map((dataset) => dataset.path),
      scorers: definition.scorers.map((scorer) => scorer.scorerName ?? '(dynamic)'),
      gates: definition.gates,
      variants: Object.fromEntries(
        Object.entries(definition.variants).map(([name, overrides]) => [name, Object.keys(overrides)]),
      ),
      paramKeys: Object.keys(definition.params ?? {}),
      // Definition-level (declared-or-1, not config-effective) so an
      // undeclared-trials definition fingerprints identically to `trials: 1`.
      trials: definition.trials ?? 1,
      replay: definition.replay?.mode,
    }),
  )
}

function taskFingerprintOf(task: unknown, detected: DetectedTask): string {
  const identity: Record<string, unknown> = { kind: detected.kind, ref: detected.ref }
  if (detected.kind === 'fn' && typeof task === 'function') {
    identity.source = sha256Hex(task.toString())
  }
  return sha256Hex(canonicalJson(identity))
}

function nearestPackageName(rootDir: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as { name?: unknown }
    return typeof parsed.name === 'string' ? parsed.name : undefined
  } catch {
    return undefined
  }
}

// ─────────────────────────────────────────────────────────────────
// Concurrency
// ─────────────────────────────────────────────────────────────────

function createLimiter(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0
  const queue: Array<() => void> = []
  const next = (): void => {
    active -= 1
    queue.shift()?.()
  }
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }
    active += 1
    try {
      return await fn()
    } finally {
      next()
    }
  }
}

class CellTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`cell timed out after ${timeoutMs}ms`)
    this.name = 'CellTimeoutError'
  }
}

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CellTimeoutError(timeoutMs)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

// ─────────────────────────────────────────────────────────────────
// Cell execution
// ─────────────────────────────────────────────────────────────────

interface CellPlan {
  resolved: ResolvedCase
  trial: number
}

interface CellRuntimeError {
  message: string
  phase: 'execute' | 'expect' | 'score' | 'replay' | 'timeout'
}

async function executeCell(input: {
  plan: CellPlan
  definition: EvaluationDefinition
  runner: TaskRunner
  effectiveParams: Record<string, unknown>
  capabilities: readonly Capability[]
  timeoutMs: number
  capture: ReturnType<typeof installSignalCapture>
  redactPaths: readonly string[]
  evaluationId: string
}): Promise<ExperimentCell<unknown, unknown>> {
  const { plan, definition, runner, effectiveParams, capabilities, timeoutMs, capture } = input
  const rawCase = plan.resolved.raw
  const startedAt = Date.now()

  const run = observe.openRun({
    name: `quality:${input.evaluationId || 'adhoc'}#${plan.resolved.caseId}`,
    rootPrimitive: 'eval.case',
    attributes: { caseId: plan.resolved.caseId, trial: plan.trial, variant: 'default' },
  })

  let output: unknown
  let cellError: CellRuntimeError | undefined
  let signals: CellSignals = emptyCellSignals()

  if (Array.isArray(rawCase.turns)) {
    cellError = {
      message:
        'multi-turn `turns` cases are not executable yet — conversational execution arrives with the adapter session runtime.',
      phase: 'execute',
    }
    run.error(new Error(cellError.message))
  } else {
    try {
      output = await withTimeout(
        () => Promise.resolve(run.withContext(() => runner(rawCase.input, effectiveParams))),
        timeoutMs,
      )
      run.end()
    } catch (error) {
      if (error instanceof QualityDefinitionError) {
        run.error(error)
        throw error
      }
      cellError = {
        message: error instanceof Error ? error.message : String(error),
        phase: error instanceof CellTimeoutError ? 'timeout' : 'execute',
      }
      run.error(error)
    }
  }

  await capture.settle()
  signals = extractCellSignals(capture.take(run.runId))

  const durationMs = Date.now() - startedAt
  const recorder = createAssertionRecorder()
  const adHocScores: CellScore[] = []

  const ctx: CaseContext<unknown, unknown, unknown, Capability> = {
    input: rawCase.input,
    output,
    expected: rawCase.expected,
    expect: createRuntimeBoundExpect({
      signals,
      recorder,
      capabilities,
      cellDurationMs: () => durationMs,
      cellErrored: () => cellError !== undefined,
    }),
    variant: { name: 'default', params: effectiveParams },
    trial: plan.trial,
    score(name, score, metadata) {
      adHocScores.push({ name, score, ...(metadata !== undefined ? { metadata } : {}) })
    },
    step: createStepAccessor(signals) as never,
    trace: { id: run.traceId },
    meta: {
      durationMs,
      ...(signals.costUsd !== undefined ? { costUsd: signals.costUsd } : {}),
      ...(signals.usage !== undefined ? { usage: signals.usage } : {}),
    },
  }

  let notEvaluated = 0
  if (cellError === undefined) {
    const callbacks: Array<{ level: 'evaluation' | 'case'; fn: (ctx: never) => void | Promise<void> }> = []
    if (definition.expect !== undefined) callbacks.push({ level: 'evaluation', fn: definition.expect })
    if (typeof rawCase.expect === 'function') callbacks.push({ level: 'case', fn: rawCase.expect })

    for (const callback of callbacks) {
      recorder.level = callback.level
      const ranBefore = recorder.ran
      try {
        await callback.fn(ctx as never)
      } catch (error) {
        if (error instanceof AssertionFailedError || error instanceof UncapturedSignalError) {
          // Hard failure aborted this callback: measure the assertions that
          // never ran by re-executing against a throwaway counting recorder
          // (matchers record but never throw; ctx.score is a no-op).
          // Callbacks are documented pure over local cell data.
          const ranInCallback = recorder.ran - ranBefore
          const countingRecorder = createAssertionRecorder()
          countingRecorder.mode = 'counting'
          const countingCtx: CaseContext<unknown, unknown, unknown, Capability> = {
            ...ctx,
            expect: createRuntimeBoundExpect({
              signals,
              recorder: countingRecorder,
              capabilities,
              cellDurationMs: () => durationMs,
              cellErrored: () => cellError !== undefined,
            }),
            score: () => {},
          }
          try {
            await callback.fn(countingCtx as never)
          } catch {
            // The counting pass relied on a failed assertion — count what ran.
          }
          notEvaluated += Math.max(0, countingRecorder.ran - ranInCallback)
        } else {
          cellError = {
            message: error instanceof Error ? error.message : String(error),
            phase: 'expect',
          }
          break
        }
      }
    }
  }

  // Scorers run even on expect-failed cells (scores inform diagnosis) — but
  // not on errored cells, which have no trustworthy output.
  const scores: CellScore[] = []
  if (cellError === undefined) {
    for (const scorer of definition.scorers) {
      try {
        const result = await scorer({ input: rawCase.input, output, expected: rawCase.expected })
        scores.push({
          name: result.name,
          score: result.score,
          ...(result.label !== undefined ? { label: result.label } : {}),
          ...(scorer.costClass !== undefined ? { costClass: scorer.costClass } : {}),
          ...(result.metadata !== undefined ? { metadata: result.metadata } : {}),
        })
      } catch (error) {
        cellError = {
          message: `scorer '${scorer.scorerName ?? scorer.name ?? '(dynamic)'}' threw: ${
            error instanceof Error ? error.message : String(error)
          }`,
          phase: 'score',
        }
        break
      }
    }
  }
  scores.push(...adHocScores)

  const failures = recorder.failures
  const passed = cellError === undefined && failures.length === 0
  scores.push({ name: 'pass', score: cellError !== undefined ? 0 : passed ? 1 : 0 })

  const redactedOutput = truncateOutput(applyRedaction(output, input.redactPaths))

  return {
    caseId: plan.resolved.caseId,
    ...(rawCase.name !== undefined ? { caseName: rawCase.name } : {}),
    variantName: 'default',
    trial: plan.trial,
    status: cellError !== undefined ? 'errored' : passed ? 'passed' : 'failed',
    input: applyRedaction(rawCase.input, input.redactPaths),
    ...(cellError === undefined ? { output: redactedOutput.value } : {}),
    ...(rawCase.expected !== undefined ? { expected: applyRedaction(rawCase.expected, input.redactPaths) } : {}),
    scores,
    assertions: {
      ran: recorder.ran,
      notEvaluated,
      failures: failures as CellAssertionFailure[],
    },
    ...(cellError !== undefined ? { error: cellError } : {}),
    durationMs,
    ...(signals.costUsd !== undefined ? { costUsd: signals.costUsd } : {}),
    ...(usageOf(signals) !== undefined ? { usage: usageOf(signals) } : {}),
    traceIds: [run.runId],
    capturedSignals: [...signals.captured],
    ...(redactedOutput.truncated ? { metadata: { truncated: true } } : {}),
  }
}

function usageOf(signals: CellSignals): { inputTokens: number; outputTokens: number } | undefined {
  if (signals.usage === undefined) return undefined
  return {
    inputTokens: signals.usage.inputTokens ?? 0,
    outputTokens: signals.usage.outputTokens ?? 0,
  }
}

// ─────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────

function evaluateGates(input: {
  gates: Gates<string> | undefined
  cells: readonly ExperimentCell<unknown, unknown>[]
  aggregate: VariantAggregate<string>
  filteredRun: boolean
}): { passed: boolean; informational: boolean; results: GateResult[] } {
  const { gates, cells, aggregate, filteredRun } = input
  const results: GateResult[] = []
  const erroredCells = cells.some((cell) => cell.status === 'errored')

  if (gates === undefined) {
    const noFailures = !erroredCells && cells.every((cell) => cell.assertions.failures.length === 0)
    results.push({ gate: 'default.assertions', threshold: true, actual: noFailures, passed: noFailures })
  } else {
    if (gates.passRate !== undefined) {
      results.push({
        gate: 'passRate.min',
        threshold: gates.passRate.min,
        actual: aggregate.passRate,
        passed: aggregate.passRate >= gates.passRate.min,
      })
    }
    for (const [name, gate] of Object.entries(gates.scores ?? {})) {
      if (gate === undefined) continue
      const score = aggregate.scores[name]
      if (gate.min !== undefined) {
        results.push({
          gate: `scores.${name}.min`,
          threshold: gate.min,
          actual: score?.mean ?? 0,
          passed: score !== undefined && score.mean >= gate.min,
        })
      }
      if (gate.max !== undefined) {
        results.push({
          gate: `scores.${name}.max`,
          threshold: gate.max,
          actual: score?.mean ?? 0,
          passed: score !== undefined && score.mean <= gate.max,
        })
      }
    }
    if (gates.latency?.p95Ms !== undefined) {
      results.push({
        gate: 'latency.p95Ms',
        threshold: gates.latency.p95Ms,
        actual: aggregate.latency.p95Ms,
        passed: aggregate.latency.p95Ms <= gates.latency.p95Ms,
      })
    }
    if (gates.latency?.meanMs !== undefined) {
      results.push({
        gate: 'latency.meanMs',
        threshold: gates.latency.meanMs,
        actual: aggregate.latency.meanMs,
        passed: aggregate.latency.meanMs <= gates.latency.meanMs,
      })
    }
    if (gates.cost?.maxPerCaseUsd !== undefined) {
      const worst = Math.max(0, ...cells.map((cell) => cell.costUsd ?? 0))
      results.push({
        gate: 'cost.maxPerCaseUsd',
        threshold: gates.cost.maxPerCaseUsd,
        actual: worst,
        passed: worst <= gates.cost.maxPerCaseUsd,
      })
    }
    if (gates.cost?.maxTotalUsd !== undefined) {
      const total = aggregate.costUsd ?? 0
      results.push({
        gate: 'cost.maxTotalUsd',
        threshold: gates.cost.maxTotalUsd,
        actual: total,
        passed: total <= gates.cost.maxTotalUsd,
      })
    }
    if (gates.consistency?.passAtK !== undefined) {
      const actual = aggregate.consistency?.passAtK ?? aggregate.passRate
      results.push({
        gate: 'consistency.passAtK',
        threshold: gates.consistency.passAtK,
        actual,
        passed: actual >= gates.consistency.passAtK,
      })
    }
    if (gates.consistency?.passAllTrials === true) {
      const actual = aggregate.consistency?.passAllTrials ?? aggregate.passRate
      results.push({
        gate: 'consistency.passAllTrials',
        threshold: true,
        actual: actual === 1,
        passed: actual === 1,
      })
    }
  }

  // False-safe: errored cells fail the run regardless of declared gates.
  const gatesPassed = results.every((result) => result.passed) && !erroredCells
  return { passed: gatesPassed, informational: filteredRun, results }
}

// ─────────────────────────────────────────────────────────────────
// runEvaluation
// ─────────────────────────────────────────────────────────────────

/**
 * Execute a normalized evaluation definition end-to-end and return the typed
 * Experiment. The public `evaluation.run()` calls this with default options;
 * the Phase 3 collector threads config-derived options through.
 *
 * @internal
 */
export async function runEvaluation(
  definition: EvaluationDefinition,
  overrides?: RunOverrides<string>,
  options: EngineOptions = {},
): Promise<Experiment<unknown, unknown, string, string>> {
  assertPhaseBoundaries(definition, overrides)

  const rootDir = options.rootDir ?? process.cwd()
  const evaluationId = options.evaluationId ?? definition.id ?? ''
  const qualityId = options.qualityId ?? nearestPackageName(rootDir) ?? 'quality'
  const redactPaths = options.redact ?? []
  const startedAtMs = Date.now()

  const detected = detectTask(definition.task)
  const runner = createTaskRunner(definition.task, detected, options.setup)

  const targetInternal = (definition.task as { [TARGET_INTERNAL]?: TargetInternal })[TARGET_INTERNAL as never] as
    | TargetInternal
    | undefined
  const effectiveParams: Record<string, unknown> = {
    ...((targetInternal?.defaults as Record<string, unknown> | undefined) ?? {}),
    ...(definition.params ?? {}),
  }

  // Resolve cases: inline + datasets, then only/skip/filters.
  const datasetCases: RawCase[] = []
  for (const dataset of definition.datasets) {
    datasetCases.push(...(await loadDataset(dataset, rootDir)))
  }
  const allCases: ResolvedCase[] = [...definition.cases, ...datasetCases].map((raw) => ({
    caseId: resolveCaseId(raw),
    raw,
  }))

  const onlyCases = allCases.filter((resolved) => resolved.raw.only === true)
  const caseFilters = overrides?.cases
  const hasFilter = (caseFilters?.length ?? 0) > 0 || onlyCases.length > 0
  const selected = allCases.filter((resolved) => {
    if (caseFilters !== undefined && caseFilters.length > 0 && !caseMatchesFilter(resolved, caseFilters)) return false
    if (onlyCases.length > 0 && resolved.raw.only !== true) return false
    return true
  })
  const filteredRun = (hasFilter && selected.length < allCases.length) || options.forceFilteredRun === true

  const evaluationSkipped = definition.flags.skip
  const trialsDefault = overrides?.trials ?? definition.trials ?? options.defaults?.trials ?? 1
  const timeoutMs = definition.timeoutMs ?? options.defaults?.timeoutMs ?? 60_000
  const concurrency = overrides?.concurrency ?? definition.concurrency ?? options.defaults?.concurrency ?? 5

  const plans: CellPlan[] = []
  const skippedCells: ExperimentCell<unknown, unknown>[] = []
  for (const resolved of selected) {
    const skip = evaluationSkipped ? 'evaluation skipped' : resolved.raw.skip
    if (skip !== undefined && skip !== false) {
      const skippedCell: ExperimentCell<unknown, unknown> = {
        caseId: resolved.caseId,
        ...(resolved.raw.name !== undefined ? { caseName: resolved.raw.name } : {}),
        variantName: 'default',
        trial: 0,
        status: 'skipped',
        ...(typeof skip === 'string' ? { skipReason: skip } : {}),
        input: applyRedaction(resolved.raw.input, redactPaths),
        scores: [],
        assertions: { ran: 0, notEvaluated: 0, failures: [] },
        durationMs: 0,
        traceIds: [],
        capturedSignals: [],
      }
      skippedCells.push(skippedCell)
      options.events?.onCellDone?.(skippedCell)
      continue
    }
    const trials = resolved.raw.trials ?? trialsDefault
    for (let trial = 0; trial < trials; trial++) {
      plans.push({ resolved, trial })
    }
  }

  const capture = installSignalCapture()
  const limiter = createLimiter(Math.max(1, concurrency))
  let cells: ExperimentCell<unknown, unknown>[]
  try {
    cells = await Promise.all(
      plans.map((plan) =>
        limiter(async () => {
          if (overrides?.signal?.aborted === true) {
            const abortedCell = {
              caseId: plan.resolved.caseId,
              ...(plan.resolved.raw.name !== undefined ? { caseName: plan.resolved.raw.name } : {}),
              variantName: 'default',
              trial: plan.trial,
              status: 'skipped',
              skipReason: 'aborted',
              input: applyRedaction(plan.resolved.raw.input, redactPaths),
              scores: [],
              assertions: { ran: 0, notEvaluated: 0, failures: [] },
              durationMs: 0,
              traceIds: [],
              capturedSignals: [],
            } satisfies ExperimentCell<unknown, unknown>
            options.events?.onCellDone?.(abortedCell)
            return abortedCell
          }
          options.events?.onCellStart?.({
            caseId: plan.resolved.caseId,
            ...(plan.resolved.raw.name !== undefined ? { caseName: plan.resolved.raw.name } : {}),
            variantName: 'default',
            trial: plan.trial,
          })
          const cell = await executeCell({
            plan,
            definition,
            runner,
            effectiveParams,
            capabilities: detected.capabilities,
            timeoutMs,
            capture,
            redactPaths,
            evaluationId,
          })
          options.events?.onCellDone?.(cell)
          return cell
        }),
      ),
    )
  } finally {
    capture.dispose()
  }
  cells.push(...skippedCells)

  // ── Aggregates (single 'default' variant in Phase 2) ──────────
  const executed = cells.filter((cell) => cell.status !== 'skipped')
  const scoreValues = new Map<string, number[]>()
  for (const cell of executed) {
    for (const score of cell.scores) {
      if (score.score === null) continue
      const bucket = scoreValues.get(score.name)
      if (bucket) bucket.push(score.score)
      else scoreValues.set(score.name, [score.score])
    }
  }
  const scores: Record<string, ScoreAggregate> = {}
  for (const [name, values] of scoreValues) {
    scores[name] = { mean: meanOf(values), sem: semOf(values), n: values.length }
  }

  const byCase = new Map<string, ExperimentCell<unknown, unknown>[]>()
  for (const cell of executed) {
    const bucket = byCase.get(cell.caseId)
    if (bucket) bucket.push(cell)
    else byCase.set(cell.caseId, [cell])
  }
  const multiTrial = [...byCase.values()].some((group) => group.length > 1)
  const consistency = multiTrial
    ? {
        passAtK:
          [...byCase.values()].filter((group) => group.some((cell) => cell.status === 'passed')).length / byCase.size,
        passAllTrials:
          [...byCase.values()].filter((group) => group.every((cell) => cell.status === 'passed')).length / byCase.size,
      }
    : undefined

  const durations = executed.map((cell) => cell.durationMs)
  const totalCost = executed.reduce<number | undefined>(
    (sum, cell) => (cell.costUsd !== undefined ? (sum ?? 0) + cell.costUsd : sum),
    undefined,
  )

  const aggregate: VariantAggregate<string> = {
    cells: cells.length,
    passed: executed.filter((cell) => cell.status === 'passed').length,
    failed: executed.filter((cell) => cell.status === 'failed').length,
    errored: executed.filter((cell) => cell.status === 'errored').length,
    skipped: cells.length - executed.length,
    passRate: executed.length === 0 ? 0 : executed.filter((cell) => cell.status === 'passed').length / executed.length,
    scores,
    ...(consistency !== undefined ? { consistency } : {}),
    latency: { meanMs: meanOf(durations), p95Ms: p95Of(durations) },
    ...(totalCost !== undefined ? { costUsd: totalCost } : {}),
  }

  const gates = evaluateGates({ gates: definition.gates, cells, aggregate, filteredRun })
  const erroredCells = executed.some((cell) => cell.status === 'errored')
  // Informational gates never fail a run; errored cells always do.
  const overallGatePassed = filteredRun ? !erroredCells : gates.passed

  const experiment: Experiment<unknown, unknown, string, string> = {
    schemaVersion: 1,
    experimentId: ulid(),
    evaluationId,
    qualityId,
    ...(options.experimentLabel !== undefined ? { experimentLabel: options.experimentLabel } : {}),
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date().toISOString(),
    configFingerprint: configFingerprintOf(definition),
    taskFingerprint: taskFingerprintOf(definition.task, detected),
    filteredRun,
    replay: { mode: definition.replay?.mode ?? 'live' },
    variants: [{ name: 'default', overrideKeys: Object.keys(definition.params ?? {}) }],
    perCase: cells,
    aggregates: { perVariant: { default: aggregate } },
    gates: { passed: overallGatePassed, informational: gates.informational, results: gates.results },
    passed: overallGatePassed && !erroredCells,
    promote: () => notImplemented('phase 4', 'experiment.promote()'),
  }

  if (options.persist !== false) {
    await persistExperiment(experiment, options.dir ?? join(rootDir, '.crux/quality'))
  }
  return experiment
}
