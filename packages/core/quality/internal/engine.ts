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
 * @internal Not exported from `@use-crux/core/quality` — engine plumbing only.
 * @module
 */

import { readFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { readFileSync } from 'node:fs'

import type { AnyPrompt } from '../../prompt/prompt-types'
import type { TokenUsage } from '../../generation/types'
import type { AnyAgent } from '../../agent/agent'
import type { FlowHandle } from '../../flow/types'
import type { Retriever, RetrieveOptions } from '../../retrieval'
import { observe, type CruxTraceId } from '../../observability'

import type { AssertContext, CaseContext } from '../expect'
import type {
  CellScore,
  Comparison,
  Experiment,
  ExperimentCell,
  RunOverrides,
  ScoreAggregate,
  VariantAggregate,
} from '../experiment'
import type {
  QualitySourceFrame,
  QualitySourceFrameResolver,
} from '../source-frame'
import type { GateResult, Gates } from '../gates'
import type { EvaluationManifest } from '../manifest'
import { resolveCaseId } from '../manifest'
import { DATASET_INTERNAL, type DatasetInternal } from '../dataset'
import {
  TARGET_INTERNAL,
  type AnyTarget,
  type Capability,
  type GenerateFn,
  type TargetInternal,
} from '../target'
import type { StandardSchemaV1 } from '../standard-schema'
import type { EvaluationDefinition, RawCase, RawDataset } from './definition'
import { detectTask, type DetectedTask } from './definition'
import type { EmbedFn } from '../scorers'
import type { NormalizedCall, ReplayMode } from '../replay'
import { invokeScorer, type ScorerRunContext } from './scorer-runtime'
import {
  CassetteMissError,
  cassettePath,
  openCassetteSession,
  type CassetteSession,
} from './cassette'
import {
  ensureCassetteDispatcher,
  withCassetteSession,
} from './cassette-context'
import { canonicalJson, sha256Hex } from './json'
import { applyRedaction, truncateOutput } from './redact'
import {
  failureFromOutcome,
  isFailureOutcome,
  redactAssertionOutcomes,
} from './assertion-outcomes'
import {
  resolveAssertionSourceFrames,
  resolveSourceFrameFromSourceRef,
} from './source-frames'
import {
  runAssertionCallbacks,
  type AssertionCallback,
} from './assertion-callbacks'
import { scoreMapFromScores } from './score-map'
import { persistExperiment } from './persist'
import { compareVariants, comparePromoted } from './compare'
import {
  buildBaselineReference,
  gitUserName,
  listBaselineRecords,
  readBaselineRecord,
  writeBaselineRecord,
  type BaselineRecord,
} from './baseline'
import {
  createAssertionRecorder,
  createRuntimeBoundExpect,
  createStepAccessor,
  captureSourceRefFromStack,
  type AssertionRecorder,
} from './expect-runtime'
import {
  cellCacheKey,
  deserializeCellSignals,
  paramsFingerprint,
  readCellCache,
  serializeCellSignals,
  writeCellCache,
} from './output-cache'
import {
  createProgrammaticSourceFrameResolver,
  ensureProgrammaticObservability,
  flushProgrammaticObservability,
} from './programmatic-runtime'
import {
  emptyCellSignals,
  extractCellSignals,
  installSignalCapture,
  type CellSignals,
} from './signals'
import {
  emitComparisonReportEdges,
  emitEvalCaseOfEdge,
  emitReplayOfEdge,
  type QualityObservabilityRunRef,
} from './observability-edges'
import { ulid } from './ulid'
import { MissingQualityModelBindingError } from './errors'
import type { ProjectModelDiagnosticCode } from '../../project-index'

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
  /** Stable diagnostic code for tooling surfaces that render definition failures. */
  readonly code?: ProjectModelDiagnosticCode

  constructor(
    message: string,
    options: { code?: ProjectModelDiagnosticCode } = {},
  ) {
    super(message)
    this.name = 'QualityDefinitionError'
    this.code = options.code
  }
}

// ─────────────────────────────────────────────────────────────────
// Engine options
// ─────────────────────────────────────────────────────────────────

/** Internal runner-supplied providers for compatibility and programmatic tests. @internal */
export interface EngineSetup {
  generate?: GenerateFn
  model?: unknown
  models?: Record<string, unknown>
  judgeModel?: unknown
  /** Embedding provider for `scorers.embeddingSimilarity`. */
  embed?: EmbedFn
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
  defaults?: {
    trials?: number
    concurrency?: number
    timeoutMs?: number
    replay?: ReplayMode
  }
  /**
   * Output-cache root (typically `<quality dir>/cache`). When set, every
   * successful task execution is cached; `RunOverrides.reuseOutputs` serves
   * unchanged cells from it (spec 03 §5 — the watch/--rescore path). A miss
   * always falls back to live execution.
   */
  cacheDir?: string
  /**
   * Authored-source frame resolver supplied by first-party tooling. Core
   * captures stack refs but delegates source-map/catalog/disk lookup so it
   * never depends on `@use-crux/indexer` or the local server implementation.
   */
  sourceFrameResolver?: QualitySourceFrameResolver
  /** Number of context lines requested on each side of assertion source frames. Default `4`. */
  sourceFrameRadius?: number
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
    onCellStart?: (cell: {
      caseId: string
      caseName?: string
      variantName: string
      trial: number
    }) => void
    onCellDone?: (cell: ExperimentCell<unknown, unknown>) => void
  }
}

// ─────────────────────────────────────────────────────────────────
// Replay resolution
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve the effective replay mode and cassette identity. Mode precedence:
 * CLI/run override > `cassette()` mode override > evaluation declaration >
 * `quality.defaults.replay` > `'live'`.
 */
function resolveReplay(
  definition: EvaluationDefinition,
  overrides: RunOverrides<string> | undefined,
  options: EngineOptions,
  evaluationId: string,
): {
  mode: ReplayMode
  name?: string
  match?: (call: NormalizedCall) => string
} {
  const ref = definition.replay?.cassette
  const cassetteRef = typeof ref === 'object' ? ref : undefined
  const mode: ReplayMode =
    overrides?.replayMode ??
    cassetteRef?.mode ??
    definition.replay?.mode ??
    options.defaults?.replay ??
    'live'
  if (mode === 'live') return { mode }
  const declaredName = typeof ref === 'string' ? ref : cassetteRef?.name
  const name = declaredName ?? (evaluationId !== '' ? evaluationId : undefined)
  if (name === undefined) {
    throw new QualityDefinitionError(
      `replay mode '${mode}' needs a cassette name — give the evaluation an explicit id or declare ` +
        "`replay: { mode, cassette: '<name>' }`.",
    )
  }
  return {
    mode,
    name,
    ...(cassetteRef?.match !== undefined ? { match: cassetteRef.match } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────
// Data resolution (inline cases + datasets)
// ─────────────────────────────────────────────────────────────────

interface ResolvedCase {
  caseId: string
  raw: RawCase
}

async function validateRow(
  schema: StandardSchemaV1,
  value: unknown,
  where: string,
): Promise<unknown> {
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

async function loadDataset(
  dataset: RawDataset,
  rootDir: string,
): Promise<RawCase[]> {
  const internal = (dataset as { [DATASET_INTERNAL]?: DatasetInternal })[
    DATASET_INTERNAL
  ]
  if (internal === undefined) {
    throw new QualityDefinitionError(
      `dataset '${dataset.path}': missing internal schemas (not built by dataset()).`,
    )
  }
  const path = isAbsolute(dataset.path)
    ? dataset.path
    : join(rootDir, dataset.path)
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
      throw new QualityDefinitionError(
        `dataset '${dataset.path}': JSON datasets must be an array of rows.`,
      )
    }
    rows = parsed
  }

  const cases: RawCase[] = []
  for (const [index, row] of rows.entries()) {
    if (row === null || typeof row !== 'object') {
      throw new QualityDefinitionError(
        `dataset '${dataset.path}': row ${index} is not an object.`,
      )
    }
    const record = row as Record<string, unknown>
    if (typeof record.expect === 'function') {
      throw new QualityDefinitionError(
        `dataset '${dataset.path}': row ${index} carries an expect callback — dataset rows are pure data.`,
      )
    }
    const inputSource = record.input !== undefined ? record.input : record
    const input = await validateRow(
      internal.input,
      inputSource,
      `dataset '${dataset.path}' row ${index}`,
    )
    const expectedSource = record.expected
    const expected =
      internal.expected !== undefined && expectedSource !== undefined
        ? await validateRow(
            internal.expected,
            expectedSource,
            `dataset '${dataset.path}' row ${index} (expected)`,
          )
        : expectedSource
    cases.push({
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      input,
      ...(expected !== undefined ? { expected } : {}),
      ...(typeof record.trials === 'number' ? { trials: record.trials } : {}),
      ...(Array.isArray(record.tags) ? { tags: record.tags as string[] } : {}),
      ...(record.skip !== undefined
        ? { skip: record.skip as boolean | string }
        : {}),
      ...(record.only !== undefined ? { only: record.only as boolean } : {}),
    })
  }
  return cases
}

function caseMatchesFilter(
  resolved: ResolvedCase,
  filters: readonly string[],
): boolean {
  return filters.some((filter) => {
    if (filter.includes('*')) {
      const pattern = new RegExp(
        `^${filter.split('*').map(escapeRegExp).join('.*')}$`,
      )
      return (
        pattern.test(resolved.caseId) ||
        (resolved.raw.name !== undefined && pattern.test(resolved.raw.name))
      )
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

type TaskRunner = (
  input: unknown,
  params: Record<string, unknown>,
) => Promise<unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** Unwrap an adapter generate result to the task output (engine contract). */
function normalizeGenerateResult(
  result: unknown,
  structured: boolean,
): unknown {
  if (isRecord(result)) {
    if (structured && 'object' in result && result.object !== undefined)
      return result.object
    if (!structured && 'text' in result && typeof result.text === 'string')
      return result.text
  }
  return result
}

function requireGenerate(
  params: Record<string, unknown>,
  setup: EngineSetup | undefined,
  kind: string,
): GenerateFn {
  const generate =
    (params.generate as GenerateFn | undefined) ?? setup?.generate
  if (typeof generate !== 'function') {
    throw new QualityDefinitionError(
      `${kind} tasks need an explicit adapter generate fn: pass \`generate\` in the eval through target defaults, params, or variants.`,
      { code: 'project_model.model_executor_missing' },
    )
  }
  return generate
}

function resolveModel(
  params: Record<string, unknown>,
  setup: EngineSetup | undefined,
): unknown {
  const ref = params.model ?? setup?.model
  if (
    typeof ref === 'string' &&
    setup?.models !== undefined &&
    ref in setup.models
  )
    return setup.models[ref]
  return ref
}

function mockTools(
  tools: Record<string, unknown> | undefined,
  mocks: Record<string, unknown> | undefined,
) {
  if (tools === undefined && mocks === undefined) return undefined
  const merged: Record<string, unknown> = { ...(tools ?? {}) }
  for (const [name, mock] of Object.entries(mocks ?? {})) {
    const original = isRecord(merged[name])
      ? (merged[name] as Record<string, unknown>)
      : {}
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
  const internal = (task as { [TARGET_INTERNAL]?: TargetInternal })[
    TARGET_INTERNAL as never
  ] as TargetInternal | undefined
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
        const activePrompt =
          (params.prompt as AnyPrompt | undefined) ?? (primitive as AnyPrompt)
        if (
          params.prompt !== undefined &&
          (params.prompt as AnyPrompt)._tag !== 'Prompt'
        ) {
          throw new QualityDefinitionError(
            'params.prompt must be a Crux prompt.',
          )
        }
        const structured = activePrompt.outputSchema !== undefined
        const opts = {
          input,
          ...(resolveModel(params, setup) !== undefined
            ? { model: resolveModel(params, setup) }
            : {}),
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
          maxSteps:
            typeof params.maxToolSteps === 'number' ? params.maxToolSteps : 15,
          ...(isRecord(params.settings) ? params.settings : {}),
        }
        const result = await generate(agentTask.prompt as never, opts as never)
        return normalizeGenerateResult(result, structured)
      }
    }
    case 'flow': {
      return async (input) => {
        const handle = primitive as FlowHandle<unknown, unknown>
        const result = await handle.run(input)
        if (result.status !== 'completed') {
          throw new Error(
            `flow '${handle.name}' did not complete: status '${result.status}'.`,
          )
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
// Variants
// ─────────────────────────────────────────────────────────────────

/**
 * One executable variant: the task runner, the merged parameter surface, and
 * the identity facts the cache and the record need. With no declared
 * variants there is exactly one implicit context named `default`.
 */
interface VariantContext {
  name: string
  runner: TaskRunner
  effectiveParams: Record<string, unknown>
  /** Cache-key params hash for this variant's effective params. */
  paramsHash: string
  /** Fingerprint of the task THIS variant executes (substituted task when overridden). */
  taskFingerprint: string
  /**
   * Capabilities of the BASE task — the expect surface is typed against the
   * base; a substituted variant task lacking a signal honest-fails at runtime.
   */
  capabilities: readonly Capability[]
  overrideKeys: string[]
  /** Serializable override values, best-effort (spec 02 §1). */
  overrides?: Record<string, unknown>
}

/** Param records merged per entry instead of replaced wholesale (spec 01 §5). */
const ENTRY_MERGED_PARAM_KEYS = new Set(['steps', 'tools'])

function mergeParams(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key]
    if (
      ENTRY_MERGED_PARAM_KEYS.has(key) &&
      isRecord(value) &&
      isRecord(existing)
    ) {
      merged[key] = { ...existing, ...value }
    } else {
      merged[key] = value
    }
  }
  return merged
}

function isJsonSerializable(value: unknown): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true
  }
  if (Array.isArray(value)) return value.every(isJsonSerializable)
  if (typeof value === 'object') {
    const proto: unknown = Object.getPrototypeOf(value)
    return (
      (proto === Object.prototype || proto === null) &&
      Object.values(value as Record<string, unknown>).every(isJsonSerializable)
    )
  }
  return false
}

function serializableOverrides(
  overrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const projection: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (isJsonSerializable(value)) projection[key] = value
  }
  return Object.keys(projection).length > 0 ? projection : undefined
}

/** Build the executable contexts for the run: declared variants, or the implicit default. */
function resolveVariantContexts(input: {
  definition: EvaluationDefinition
  detected: DetectedTask
  baseRunner: TaskRunner
  baseParams: Record<string, unknown>
  baseTaskFingerprint: string
  setup: EngineSetup | undefined
}): VariantContext[] {
  const {
    definition,
    detected,
    baseRunner,
    baseParams,
    baseTaskFingerprint,
    setup,
  } = input
  const declared = Object.entries(definition.variants)
  if (declared.length === 0) {
    return [
      {
        name: 'default',
        runner: baseRunner,
        effectiveParams: baseParams,
        paramsHash: paramsFingerprint(baseParams),
        taskFingerprint: baseTaskFingerprint,
        capabilities: detected.capabilities,
        overrideKeys: Object.keys(definition.params ?? {}),
      },
    ]
  }
  return declared.map(([name, overrides]) => {
    const { task: taskOverride, ...paramOverrides } = overrides as {
      task?: unknown
    } & Record<string, unknown>
    let runner = baseRunner
    let taskFingerprint = baseTaskFingerprint
    if (taskOverride !== undefined) {
      const detectedOverride = detectTask(taskOverride)
      runner = createTaskRunner(taskOverride, detectedOverride, setup)
      taskFingerprint = taskFingerprintOf(taskOverride, detectedOverride)
    }
    const effectiveParams = mergeParams(baseParams, paramOverrides)
    const serializable = serializableOverrides(overrides)
    return {
      name,
      runner,
      effectiveParams,
      paramsHash: paramsFingerprint(effectiveParams),
      taskFingerprint,
      capabilities: detected.capabilities,
      overrideKeys: Object.keys(overrides),
      ...(serializable !== undefined ? { overrides: serializable } : {}),
    }
  })
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
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1)
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
      scorers: definition.scorers.map(
        (scorer) => scorer.scorerName ?? '(dynamic)',
      ),
      gates: definition.gates,
      variants: Object.fromEntries(
        Object.entries(definition.variants).map(([name, overrides]) => [
          name,
          Object.keys(overrides),
        ]),
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
  const identity: Record<string, unknown> = {
    kind: detected.kind,
    ref: detected.ref,
  }
  if (detected.kind === 'fn' && typeof task === 'function') {
    identity.source = sha256Hex(task.toString())
  }
  return sha256Hex(canonicalJson(identity))
}

function nearestPackageName(rootDir: string): string | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(join(rootDir, 'package.json'), 'utf8'),
    ) as { name?: unknown }
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

async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new CellTimeoutError(timeoutMs)),
          timeoutMs,
        )
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
  variant: VariantContext
}

interface CellRuntimeError {
  message: string
  phase: 'execute' | 'expect' | 'assert' | 'score' | 'replay' | 'timeout'
  /** Set for replay-strict misses: the missing cassette key. */
  missingCassetteKey?: string
  /** Best-effort `file:line:column` for callback/task crashes. */
  sourceRef?: string
  /** Authored frame for callback/task crashes, when the runner can resolve it. */
  sourceFrame?: QualitySourceFrame
}

interface CellCacheContext {
  dir: string
  reuse: boolean
  replayMode: string
}

async function executeCell(input: {
  plan: CellPlan
  definition: EvaluationDefinition
  timeoutMs: number
  capture: ReturnType<typeof installSignalCapture>
  redactPaths: readonly string[]
  evaluationId: string
  evaluationTraceId: CruxTraceId
  setup?: EngineSetup
  cache?: CellCacheContext
  sourceFrameResolver?: QualitySourceFrameResolver
  sourceFrameRadius?: number
}): Promise<ExperimentCell<unknown, unknown>> {
  const { plan, definition, timeoutMs, capture } = input
  const { runner, effectiveParams, capabilities } = plan.variant
  const rawCase = plan.resolved.raw
  const startedAt = Date.now()

  const cacheKey =
    input.cache === undefined
      ? undefined
      : cellCacheKey({
          caseId: plan.resolved.caseId,
          variantName: plan.variant.name,
          trial: plan.trial,
          taskFingerprint: plan.variant.taskFingerprint,
          paramsHash: plan.variant.paramsHash,
          replayMode: input.cache.replayMode,
        })

  // Cache hit (spec 03 §5): skip task execution entirely, reuse the stored
  // output + signals, re-run expects and scorers fresh below.
  if (
    input.cache?.reuse === true &&
    cacheKey !== undefined &&
    !Array.isArray(rawCase.turns)
  ) {
    const cached = await readCellCache(
      input.cache.dir,
      input.evaluationId,
      cacheKey,
    )
    if (cached !== undefined) {
      return assembleCell({
        input,
        rawCase,
        plan,
        capabilities,
        output: cached.output,
        cellError: undefined,
        signals: deserializeCellSignals(cached.signals),
        durationMs: cached.durationMs,
        traceIds: cached.traceIds,
        cached: true,
      })
    }
  }

  const run = observe.openRun({
    traceId: input.evaluationTraceId,
    name: `quality:${input.evaluationId || 'adhoc'}#${plan.resolved.caseId}`,
    rootPrimitive: 'eval.case',
    attributes: {
      caseId: plan.resolved.caseId,
      trial: plan.trial,
      variant: plan.variant.name,
    },
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
        () =>
          Promise.resolve(
            run.withContext(() => runner(rawCase.input, effectiveParams)),
          ),
        timeoutMs,
      )
      run.end()
    } catch (error) {
      if (error instanceof QualityDefinitionError) {
        run.error(error)
        throw error
      }
      const sourceRef =
        error instanceof Error
          ? captureSourceRefFromStack(error.stack)
          : undefined
      cellError = {
        message: error instanceof Error ? error.message : String(error),
        phase:
          error instanceof CellTimeoutError
            ? 'timeout'
            : error instanceof CassetteMissError
              ? 'replay'
              : 'execute',
        ...(error instanceof CassetteMissError
          ? { missingCassetteKey: error.key }
          : {}),
        ...(sourceRef !== undefined ? { sourceRef } : {}),
      }
      run.error(error)
    }
  }

  // Task latency only — capture settling is runner plumbing, not the cell's
  // execution time (spec 02: latency aggregates feed gates).
  const durationMs = Date.now() - startedAt

  await capture.settle()
  signals = extractCellSignals(capture.take(run.runId))

  // Keep the cache warm (best-effort): redacted but NEVER truncated output —
  // truncation is a record-display concern and would corrupt re-scoring.
  if (
    input.cache !== undefined &&
    cacheKey !== undefined &&
    cellError === undefined &&
    !Array.isArray(rawCase.turns)
  ) {
    await writeCellCache(input.cache.dir, input.evaluationId, cacheKey, {
      output: applyRedaction(output, input.redactPaths),
      signals: serializeCellSignals(signals),
      durationMs,
      traceIds: [run.runId],
      cachedAt: new Date().toISOString(),
    })
  }

  return assembleCell({
    input,
    rawCase,
    plan,
    capabilities,
    output,
    cellError,
    signals,
    durationMs,
    traceIds: [run.runId],
    traceId: run.traceId,
    cached: false,
  })
}

/**
 * Run expects + scorers over an executed (or cache-served) cell and build
 * the ExperimentCell. Shared by the live path and the reuseOutputs path —
 * assertions and scores are ALWAYS computed fresh; only task execution is
 * ever served from the cache.
 */
async function assembleCell(args: {
  input: {
    definition: EvaluationDefinition
    redactPaths: readonly string[]
    setup?: EngineSetup
    sourceFrameResolver?: QualitySourceFrameResolver
    sourceFrameRadius?: number
  }
  rawCase: RawCase
  plan: CellPlan
  capabilities: readonly Capability[]
  output: unknown
  cellError: CellRuntimeError | undefined
  signals: CellSignals
  durationMs: number
  traceIds: readonly string[]
  traceId?: string
  cached: boolean
}): Promise<ExperimentCell<unknown, unknown>> {
  const {
    input,
    rawCase,
    plan,
    capabilities,
    output,
    signals,
    durationMs,
    traceIds,
    cached,
  } = args
  const { definition } = input
  const { effectiveParams } = plan.variant
  let cellError = args.cellError
  const recorder = createAssertionRecorder()
  const adHocScores: CellScore[] = []

  const expectContext: CaseContext<unknown, unknown, unknown, Capability> = {
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
    variant: { name: plan.variant.name, params: effectiveParams },
    trial: plan.trial,
    score(name, score, metadata) {
      adHocScores.push({
        name,
        score,
        ...(metadata !== undefined ? { metadata } : {}),
      })
    },
    step: createStepAccessor(signals) as never,
    trace: { id: args.traceId ?? traceIds[0] ?? '' },
    meta: {
      durationMs,
      ...(signals.costUsd !== undefined ? { costUsd: signals.costUsd } : {}),
      ...(signals.usage !== undefined ? { usage: signals.usage } : {}),
    },
  }

  let notEvaluated = 0
  if (cellError === undefined) {
    const callbacks: AssertionCallback<
      CaseContext<unknown, unknown, unknown, Capability>
    >[] = []
    if (definition.expect !== undefined) {
      callbacks.push({
        phase: 'expect',
        level: 'evaluation',
        fn: definition.expect as AssertionCallback<
          CaseContext<unknown, unknown, unknown, Capability>
        >['fn'],
      })
    }
    if (typeof rawCase.expect === 'function') {
      callbacks.push({
        phase: 'expect',
        level: 'case',
        fn: rawCase.expect as AssertionCallback<
          CaseContext<unknown, unknown, unknown, Capability>
        >['fn'],
      })
    }

    const result = await runAssertionCallbacks({
      callbacks,
      context: expectContext,
      recorder,
      createCountingContext: (countingRecorder) => ({
        ...expectContext,
        expect: createRuntimeBoundExpect({
          signals,
          recorder: countingRecorder,
          capabilities,
          cellDurationMs: () => durationMs,
          cellErrored: () => cellError !== undefined,
        }),
        score: () => {},
      }),
    })
    notEvaluated += result.notEvaluated
    if (result.error !== undefined) {
      cellError = result.error
    }
  }

  // Scorers run even on expect-failed cells (scores inform diagnosis) — but
  // not on errored cells, which have no trustworthy output.
  const scores: CellScore[] = []
  if (cellError === undefined) {
    // Model-backed built-ins receive ambient providers + this cell's signals
    // through the contextual channel; plain scorers see the autoevals shape.
    const scorerContext: ScorerRunContext = { ...(input.setup ?? {}), signals }
    for (const scorer of definition.scorers) {
      try {
        const result = await invokeScorer(
          scorer,
          { input: rawCase.input, output, expected: rawCase.expected },
          scorerContext,
        )
        scores.push({
          name: result.name,
          score: result.score,
          ...(result.label !== undefined ? { label: result.label } : {}),
          ...(scorer.costClass !== undefined
            ? { costClass: scorer.costClass }
            : {}),
          ...(result.metadata !== undefined
            ? { metadata: result.metadata }
            : {}),
        })
      } catch (error) {
        if (error instanceof MissingQualityModelBindingError) {
          throw new QualityDefinitionError(error.message, { code: error.code })
        }
        const sourceRef =
          error instanceof Error
            ? captureSourceRefFromStack(error.stack)
            : undefined
        cellError = {
          message: `scorer '${scorer.scorerName ?? scorer.name ?? '(dynamic)'}' threw: ${
            error instanceof Error ? error.message : String(error)
          }`,
          phase: error instanceof CassetteMissError ? 'replay' : 'score',
          ...(error instanceof CassetteMissError
            ? { missingCassetteKey: error.key }
            : {}),
          ...(sourceRef !== undefined ? { sourceRef } : {}),
        }
        break
      }
    }
  }
  scores.push(...adHocScores)

  if (cellError === undefined) {
    const scoreMap = scoreMapFromScores(scores)
    const assertContext: AssertContext<
      unknown,
      unknown,
      unknown,
      string,
      Capability
    > = {
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
      score: scoreMap,
      scores,
      variant: { name: plan.variant.name, params: effectiveParams },
      trial: plan.trial,
      step: createStepAccessor(signals) as never,
      trace: { id: args.traceId ?? traceIds[0] ?? '' },
      meta: {
        durationMs,
        ...(signals.costUsd !== undefined ? { costUsd: signals.costUsd } : {}),
        ...(signals.usage !== undefined ? { usage: signals.usage } : {}),
      },
    }
    const callbacks: AssertionCallback<
      AssertContext<unknown, unknown, unknown, string, Capability>
    >[] = []
    if (definition.assert !== undefined) {
      callbacks.push({
        phase: 'assert',
        level: 'evaluation',
        fn: definition.assert as AssertionCallback<
          AssertContext<unknown, unknown, unknown, string, Capability>
        >['fn'],
      })
    }
    if (typeof rawCase.assert === 'function') {
      callbacks.push({
        phase: 'assert',
        level: 'case',
        fn: rawCase.assert as AssertionCallback<
          AssertContext<unknown, unknown, unknown, string, Capability>
        >['fn'],
      })
    }

    const result = await runAssertionCallbacks({
      callbacks,
      context: assertContext,
      recorder,
      createCountingContext: (countingRecorder) => ({
        ...assertContext,
        expect: createRuntimeBoundExpect({
          signals,
          recorder: countingRecorder,
          capabilities,
          cellDurationMs: () => durationMs,
          cellErrored: () => cellError !== undefined,
        }),
      }),
    })
    notEvaluated += result.notEvaluated
    if (result.error !== undefined) {
      cellError = result.error
    }
  }

  const outcomes = await resolveAssertionSourceFrames({
    outcomes: redactAssertionOutcomes(recorder.outcomes, input.redactPaths),
    resolver: input.sourceFrameResolver,
    frameRadius: input.sourceFrameRadius,
  })
  if (
    cellError?.sourceRef !== undefined &&
    input.sourceFrameResolver !== undefined
  ) {
    cellError = {
      ...cellError,
      sourceFrame: await resolveSourceFrameFromSourceRef({
        sourceRef: cellError.sourceRef,
        resolver: input.sourceFrameResolver,
        frameRadius: input.sourceFrameRadius,
        role: 'failed',
      }),
    }
  }
  const failures = outcomes.filter(isFailureOutcome).map(failureFromOutcome)
  const passed = cellError === undefined && failures.length === 0
  scores.push({
    name: 'pass',
    score: cellError !== undefined ? 0 : passed ? 1 : 0,
  })

  const redactedOutput = truncateOutput(
    applyRedaction(output, input.redactPaths),
  )

  const metadata: Record<string, unknown> = {
    ...(redactedOutput.truncated ? { truncated: true } : {}),
    ...(cached ? { cached: true } : {}),
  }

  return {
    caseId: plan.resolved.caseId,
    ...(rawCase.name !== undefined ? { caseName: rawCase.name } : {}),
    variantName: plan.variant.name,
    trial: plan.trial,
    status: cellError !== undefined ? 'errored' : passed ? 'passed' : 'failed',
    input: applyRedaction(rawCase.input, input.redactPaths),
    ...(cellError === undefined ? { output: redactedOutput.value } : {}),
    ...(rawCase.expected !== undefined
      ? { expected: applyRedaction(rawCase.expected, input.redactPaths) }
      : {}),
    scores,
    assertions: {
      ran: recorder.ran,
      notEvaluated,
      failures,
      outcomes,
    },
    ...(cellError !== undefined ? { error: cellError } : {}),
    durationMs,
    ...(signals.costUsd !== undefined ? { costUsd: signals.costUsd } : {}),
    ...(usageOf(signals) !== undefined ? { usage: usageOf(signals) } : {}),
    traceIds: [...traceIds],
    capturedSignals: [...signals.captured],
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

function usageOf(
  signals: CellSignals,
): { inputTokens: number; outputTokens: number } | undefined {
  if (signals.usage === undefined) return undefined
  return {
    inputTokens: signals.usage.inputTokens ?? 0,
    outputTokens: signals.usage.outputTokens ?? 0,
  }
}

// ─────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────

/** Gate evaluation for ONE variant's aggregate. `variantName` set when variants are declared. */
function evaluateVariantGates(input: {
  gates: Gates<string>
  cells: readonly ExperimentCell<unknown, unknown>[]
  aggregate: VariantAggregate<string>
  variantName: string | undefined
  comparison: Comparison<string> | undefined
  comparisonBlocking: boolean
}): GateResult[] {
  const {
    gates,
    cells,
    aggregate,
    variantName,
    comparison,
    comparisonBlocking,
  } = input
  const results: GateResult[] = []
  const named = (result: Omit<GateResult, 'variantName'>): GateResult => ({
    ...result,
    ...(variantName !== undefined ? { variantName } : {}),
  })

  if (gates.passRate !== undefined) {
    results.push(
      named({
        gate: 'passRate.min',
        threshold: gates.passRate.min,
        actual: aggregate.passRate,
        passed: aggregate.passRate >= gates.passRate.min,
      }),
    )
  }
  for (const [name, gate] of Object.entries(gates.scores ?? {})) {
    if (gate === undefined) continue
    const score = aggregate.scores[name]
    if (gate.min !== undefined) {
      results.push(
        named({
          gate: `scores.${name}.min`,
          threshold: gate.min,
          actual: score?.mean ?? 0,
          passed: score !== undefined && score.mean >= gate.min,
        }),
      )
    }
    if (gate.max !== undefined) {
      results.push(
        named({
          gate: `scores.${name}.max`,
          threshold: gate.max,
          actual: score?.mean ?? 0,
          passed: score !== undefined && score.mean <= gate.max,
        }),
      )
    }
    if (gate.minDeltaVsBaseline !== undefined) {
      // Requires a comparison reference (declared baseline variant or a
      // promoted baseline). The delta gate evaluates the PAIRED mean delta.
      const delta = comparison?.deltas.find(
        (entry) =>
          entry.scoreName === name &&
          (variantName === undefined || entry.variantName === variantName),
      )
      results.push({
        ...named({
          gate: `scores.${name}.minDeltaVsBaseline`,
          threshold: gate.minDeltaVsBaseline,
          actual: delta?.meanDelta ?? 0,
          passed:
            delta !== undefined && delta.meanDelta >= gate.minDeltaVsBaseline,
        }),
        // A drifted (informational) comparison cannot block — the case
        // populations are no longer matched (spec 02 §3).
        ...(comparisonBlocking ? {} : { informational: true }),
      })
    }
  }
  if (gates.latency?.p95Ms !== undefined) {
    results.push(
      named({
        gate: 'latency.p95Ms',
        threshold: gates.latency.p95Ms,
        actual: aggregate.latency.p95Ms,
        passed: aggregate.latency.p95Ms <= gates.latency.p95Ms,
      }),
    )
  }
  if (gates.latency?.meanMs !== undefined) {
    results.push(
      named({
        gate: 'latency.meanMs',
        threshold: gates.latency.meanMs,
        actual: aggregate.latency.meanMs,
        passed: aggregate.latency.meanMs <= gates.latency.meanMs,
      }),
    )
  }
  if (gates.cost?.maxPerCaseUsd !== undefined) {
    const worst = Math.max(0, ...cells.map((cell) => cell.costUsd ?? 0))
    results.push(
      named({
        gate: 'cost.maxPerCaseUsd',
        threshold: gates.cost.maxPerCaseUsd,
        actual: worst,
        passed: worst <= gates.cost.maxPerCaseUsd,
      }),
    )
  }
  if (gates.cost?.maxTotalUsd !== undefined) {
    const total = aggregate.costUsd ?? 0
    results.push(
      named({
        gate: 'cost.maxTotalUsd',
        threshold: gates.cost.maxTotalUsd,
        actual: total,
        passed: total <= gates.cost.maxTotalUsd,
      }),
    )
  }
  if (gates.consistency?.passAtK !== undefined) {
    const actual = aggregate.consistency?.passAtK ?? aggregate.passRate
    results.push(
      named({
        gate: 'consistency.passAtK',
        threshold: gates.consistency.passAtK,
        actual,
        passed: actual >= gates.consistency.passAtK,
      }),
    )
  }
  if (gates.consistency?.passAllTrials === true) {
    const actual = aggregate.consistency?.passAllTrials ?? aggregate.passRate
    results.push(
      named({
        gate: 'consistency.passAllTrials',
        threshold: true,
        actual: actual === 1,
        passed: actual === 1,
      }),
    )
  }
  return results
}

/**
 * Evaluate the gate policy over the whole run. With declared variants, gates
 * evaluate per non-baseline variant (spec 02 §1 `GateResult.variantName`);
 * the zero-config default stays a single assertions verdict over all cells.
 */
function evaluateGates(input: {
  gates: Gates<string> | undefined
  cells: readonly ExperimentCell<unknown, unknown>[]
  aggregates: Record<string, VariantAggregate<string>>
  gateVariantNames: readonly string[]
  variantsDeclared: boolean
  comparison: Comparison<string> | undefined
  comparisonBlocking: boolean
  filteredRun: boolean
}): { passed: boolean; informational: boolean; results: GateResult[] } {
  const { gates, cells, filteredRun } = input
  const results: GateResult[] = []
  const erroredCells = cells.some((cell) => cell.status === 'errored')

  if (gates === undefined) {
    const noFailures =
      !erroredCells &&
      cells.every((cell) => cell.assertions.failures.length === 0)
    results.push({
      gate: 'default.assertions',
      threshold: true,
      actual: noFailures,
      passed: noFailures,
    })
  } else {
    for (const name of input.gateVariantNames) {
      const aggregate = input.aggregates[name]
      if (aggregate === undefined) continue
      results.push(
        ...evaluateVariantGates({
          gates,
          cells: cells.filter((cell) => cell.variantName === name),
          aggregate,
          variantName: input.variantsDeclared ? name : undefined,
          comparison: input.comparison,
          comparisonBlocking: input.comparisonBlocking,
        }),
      )
    }
  }

  // False-safe: errored cells fail the run regardless of declared gates.
  // Informational results (drifted baseline comparison) never block.
  const gatesPassed =
    results.every((result) => result.passed || result.informational === true) &&
    !erroredCells
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
/** Aggregate one variant's cells (skipped cells included in the counts). */
function aggregateVariant(
  cells: readonly ExperimentCell<unknown, unknown>[],
): VariantAggregate<string> {
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
    scores[name] = {
      mean: meanOf(values),
      sem: semOf(values),
      n: values.length,
    }
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
          [...byCase.values()].filter((group) =>
            group.some((cell) => cell.status === 'passed'),
          ).length / byCase.size,
        passAllTrials:
          [...byCase.values()].filter((group) =>
            group.every((cell) => cell.status === 'passed'),
          ).length / byCase.size,
      }
    : undefined

  const durations = executed.map((cell) => cell.durationMs)
  const totalCost = executed.reduce<number | undefined>(
    (sum, cell) =>
      cell.costUsd !== undefined ? (sum ?? 0) + cell.costUsd : sum,
    undefined,
  )

  return {
    cells: cells.length,
    passed: executed.filter((cell) => cell.status === 'passed').length,
    failed: executed.filter((cell) => cell.status === 'failed').length,
    errored: executed.filter((cell) => cell.status === 'errored').length,
    skipped: cells.length - executed.length,
    passRate:
      executed.length === 0
        ? 0
        : executed.filter((cell) => cell.status === 'passed').length /
          executed.length,
    scores,
    ...(consistency !== undefined ? { consistency } : {}),
    latency: { meanMs: meanOf(durations), p95Ms: p95Of(durations) },
    ...(totalCost !== undefined ? { costUsd: totalCost } : {}),
  }
}

export async function runEvaluation(
  definition: EvaluationDefinition,
  overrides?: RunOverrides<string>,
  options: EngineOptions = {},
): Promise<Experiment<unknown, unknown, string, string>> {
  const rootDir = options.rootDir ?? process.cwd()
  const observabilityEnabled = await ensureProgrammaticObservability()
  try {
    return await runEvaluationInner(definition, overrides, {
      ...options,
      rootDir,
      ...(options.sourceFrameResolver === undefined
        ? {
            sourceFrameResolver: createProgrammaticSourceFrameResolver(rootDir),
          }
        : {}),
    })
  } finally {
    await flushProgrammaticObservability(observabilityEnabled)
  }
}

async function runEvaluationInner(
  definition: EvaluationDefinition,
  overrides?: RunOverrides<string>,
  options: EngineOptions = {},
): Promise<Experiment<unknown, unknown, string, string>> {
  const rootDir = options.rootDir ?? process.cwd()
  const qualityDir = options.dir ?? join(rootDir, '.crux/quality')
  const evaluationId = options.evaluationId ?? definition.id ?? ''
  const qualityId =
    options.qualityId ?? nearestPackageName(rootDir) ?? 'quality'
  const redactPaths = options.redact ?? []
  const startedAtMs = Date.now()
  const configFingerprint = configFingerprintOf(definition)

  // ── Replay: resolve the mode, open the cassette session ─────────
  const replay = resolveReplay(definition, overrides, options, evaluationId)
  let cassetteSession: CassetteSession | undefined
  if (replay.mode !== 'live') {
    ensureCassetteDispatcher()
    cassetteSession = await openCassetteSession({
      path: cassettePath(qualityDir, replay.name!),
      mode: replay.mode,
      redactPaths,
      ...(replay.match !== undefined ? { match: replay.match } : {}),
    })
  }

  const detected = detectTask(definition.task)
  const baseRunner = createTaskRunner(definition.task, detected, options.setup)
  const taskFingerprint = taskFingerprintOf(definition.task, detected)

  const targetInternal = (
    definition.task as { [TARGET_INTERNAL]?: TargetInternal }
  )[TARGET_INTERNAL as never] as TargetInternal | undefined
  const baseParams = mergeParams(
    (targetInternal?.defaults as Record<string, unknown> | undefined) ?? {},
    definition.params ?? {},
  )

  // ── Variants: declared contexts (or the implicit default), then filter ──
  const variantsDeclared = Object.keys(definition.variants).length > 0
  const allVariantContexts = resolveVariantContexts({
    definition,
    detected,
    baseRunner,
    baseParams,
    baseTaskFingerprint: taskFingerprint,
    setup: options.setup,
  })
  let variantContexts = allVariantContexts
  let variantSubsetDemotes = false
  const variantFilter = overrides?.variants
  if (variantFilter !== undefined && variantFilter.length > 0) {
    const known = new Set(allVariantContexts.map((context) => context.name))
    for (const name of variantFilter) {
      if (!known.has(name)) {
        throw new QualityDefinitionError(
          `unknown variant '${name}' — this evaluation declares: ${[...known].join(', ')}.`,
        )
      }
    }
    const filterSet = new Set(variantFilter)
    variantContexts = allVariantContexts.filter((context) =>
      filterSet.has(context.name),
    )
    // A variant subset only stays blocking when the baseline variant still
    // runs — paired comparison needs the reference population (spec 03 §4).
    const subset = variantContexts.length < allVariantContexts.length
    variantSubsetDemotes =
      subset &&
      (definition.baseline === undefined || !filterSet.has(definition.baseline))
  }
  const selectedVariantNames = variantContexts.map((context) => context.name)

  // Output cache context (spec 03 §5). Reads are opt-in via reuseOutputs;
  // writes happen on every successful execution when a cacheDir is set.
  const cacheContext =
    options.cacheDir === undefined
      ? undefined
      : {
          dir: options.cacheDir,
          reuse: overrides?.reuseOutputs === true,
          replayMode: replay.mode,
        }

  // ── Committed baseline lookup + id-drift guard (before any execution) ──
  let baselineRecord: BaselineRecord | undefined
  if (definition.baseline === undefined && evaluationId !== '') {
    baselineRecord = await readBaselineRecord(qualityDir, evaluationId)
    if (baselineRecord === undefined) {
      const promotedElsewhere = (await listBaselineRecords(qualityDir)).find(
        (record) =>
          record.configFingerprint === configFingerprint &&
          record.evaluationId !== evaluationId,
      )
      if (promotedElsewhere !== undefined) {
        throw new QualityDefinitionError(
          `this evaluation was promoted as '${promotedElsewhere.evaluationId}' but its id resolves to ` +
            `'${evaluationId}' — pin the promoted id in source: evaluate('${promotedElsewhere.evaluationId}', { … }).`,
        )
      }
    }
  }

  // Resolve cases: inline + datasets, then only/skip/filters.
  const datasetCases: RawCase[] = []
  for (const dataset of definition.datasets) {
    datasetCases.push(...(await loadDataset(dataset, rootDir)))
  }
  const allCases: ResolvedCase[] = [...definition.cases, ...datasetCases].map(
    (raw) => ({
      caseId: resolveCaseId(raw),
      raw,
    }),
  )

  const onlyCases = allCases.filter((resolved) => resolved.raw.only === true)
  const caseFilters = overrides?.cases
  const hasFilter = (caseFilters?.length ?? 0) > 0 || onlyCases.length > 0
  const selected = allCases.filter((resolved) => {
    if (
      caseFilters !== undefined &&
      caseFilters.length > 0 &&
      !caseMatchesFilter(resolved, caseFilters)
    )
      return false
    if (onlyCases.length > 0 && resolved.raw.only !== true) return false
    return true
  })
  const filteredRun =
    (hasFilter && selected.length < allCases.length) ||
    options.forceFilteredRun === true ||
    variantSubsetDemotes

  const evaluationSkipped = definition.flags.skip
  const trialsDefault =
    overrides?.trials ?? definition.trials ?? options.defaults?.trials ?? 1
  let trialsCollapsed = false
  const timeoutMs =
    definition.timeoutMs ?? options.defaults?.timeoutMs ?? 60_000
  const concurrency =
    overrides?.concurrency ??
    definition.concurrency ??
    options.defaults?.concurrency ??
    5

  const plans: CellPlan[] = []
  const skippedCells: ExperimentCell<unknown, unknown>[] = []
  for (const variant of variantContexts) {
    for (const resolved of selected) {
      const skip = evaluationSkipped ? 'evaluation skipped' : resolved.raw.skip
      if (skip !== undefined && skip !== false) {
        const skippedCell: ExperimentCell<unknown, unknown> = {
          caseId: resolved.caseId,
          ...(resolved.raw.name !== undefined
            ? { caseName: resolved.raw.name }
            : {}),
          variantName: variant.name,
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
      // Under replay-strict, trials of one cell are byte-identical — collapse
      // to one execution and note it on the record (spec 01 §10, §18.1).
      const declaredTrials = resolved.raw.trials ?? trialsDefault
      const trials = replay.mode === 'replay-strict' ? 1 : declaredTrials
      if (trials < declaredTrials) trialsCollapsed = true
      for (let trial = 0; trial < trials; trial++) {
        plans.push({ resolved, trial, variant })
      }
    }
  }

  const evalRun = observe.openRun({
    name: `quality:${evaluationId || 'adhoc'}`,
    rootPrimitive: 'eval.run',
    attributes: {
      evaluationId,
      caseCount: selected.length,
      variantCount: variantContexts.length,
    },
  })
  const evalRunRef: QualityObservabilityRunRef = {
    runId: evalRun.runId,
    traceId: evalRun.traceId,
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
              ...(plan.resolved.raw.name !== undefined
                ? { caseName: plan.resolved.raw.name }
                : {}),
              variantName: plan.variant.name,
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
            ...(plan.resolved.raw.name !== undefined
              ? { caseName: plan.resolved.raw.name }
              : {}),
            variantName: plan.variant.name,
            trial: plan.trial,
          })
          const execute = () =>
            executeCell({
              plan,
              definition,
              timeoutMs,
              capture,
              redactPaths,
              evaluationId,
              evaluationTraceId: evalRun.traceId,
              setup: options.setup,
              cache: cacheContext,
              sourceFrameResolver: options.sourceFrameResolver,
              sourceFrameRadius: options.sourceFrameRadius,
            })
          // The cassette scope covers scoring too — judge calls record and
          // replay through the same cassette as task calls.
          const cell =
            cassetteSession === undefined
              ? await execute()
              : await withCassetteSession(cassetteSession, execute)
          for (const runId of cell.traceIds) {
            evalRun.withContext(() => {
              emitEvalCaseOfEdge({
                caseRunId: runId,
                evalRunId: evalRun.runId,
              })
              if (
                replay.mode === 'replay-strict' &&
                cassetteSession?.recorded !== undefined
              ) {
                emitReplayOfEdge({
                  replay: { runId, traceId: evalRun.traceId },
                  recorded: cassetteSession.recorded,
                })
              }
            })
          }
          options.events?.onCellDone?.(cell)
          return cell
        }),
      ),
    )
  } catch (error) {
    evalRun.error(error)
    throw error
  } finally {
    capture.dispose()
  }
  try {
    cells.push(...skippedCells)
    await cassetteSession?.flush()

    // ── Aggregates, per variant ─────────────────────────────────────
    const aggregates: Record<string, VariantAggregate<string>> = {}
    for (const variant of variantContexts) {
      aggregates[variant.name] = aggregateVariant(
        cells.filter((cell) => cell.variantName === variant.name),
      )
    }

    // ── Comparison: declared baseline variant, else promoted baseline ──
    let comparison: Comparison<string> | undefined
    let baselineRef: Experiment<unknown, unknown, string, string>['baselineRef']
    if (
      definition.baseline !== undefined &&
      selectedVariantNames.includes(definition.baseline)
    ) {
      comparison = compareVariants({
        cells,
        baselineName: definition.baseline,
        candidateNames: selectedVariantNames.filter(
          (name) => name !== definition.baseline,
        ),
      })
    } else if (baselineRecord !== undefined) {
      baselineRef = {
        baselineId: baselineRecord.baselineId,
        experimentId: baselineRecord.experimentId,
        ...(baselineRecord.variantName !== undefined
          ? { variantName: baselineRecord.variantName }
          : {}),
      }
      comparison = comparePromoted({
        cells,
        variantNames: selectedVariantNames,
        reference: baselineRecord.reference,
        baselineExperimentId: baselineRecord.experimentId,
      })
      if (baselineRecord.configFingerprint !== configFingerprint) {
        comparison = {
          ...comparison,
          demoted: {
            reason:
              'cases or definition changed since promotion (configFingerprint mismatch) — ' +
              'comparison is informational; re-promote to re-arm baseline gates',
          },
        }
      }
    }
    const comparisonBlocking =
      comparison !== undefined && comparison.demoted === undefined

    if (comparison !== undefined) {
      evalRun.withContext(() => {
        emitComparisonReportEdges({
          comparison,
          candidate: evalRunRef,
          ...(baselineRecord?.observability !== undefined
            ? { baseline: baselineRecord.observability }
            : {}),
        })
      })
    }

    // ── Gates: per non-baseline variant (single default keeps Phase 2 shape) ──
    const gateVariantNames = variantsDeclared
      ? selectedVariantNames.filter((name) => name !== definition.baseline)
      : selectedVariantNames
    const gates = evaluateGates({
      gates: definition.gates,
      cells,
      aggregates,
      gateVariantNames,
      variantsDeclared,
      comparison,
      comparisonBlocking,
      filteredRun,
    })
    const erroredCells = cells.some((cell) => cell.status === 'errored')
    // Informational gates never fail a run; errored cells always do.
    const overallGatePassed = filteredRun ? !erroredCells : gates.passed

    const experiment: Experiment<unknown, unknown, string, string> = {
      schemaVersion: 1,
      experimentId: ulid(),
      evaluationId,
      qualityId,
      ...(options.experimentLabel !== undefined
        ? { experimentLabel: options.experimentLabel }
        : {}),
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date().toISOString(),
      configFingerprint,
      taskFingerprint,
      observability: evalRunRef,
      filteredRun,
      replay: {
        mode: replay.mode,
        ...(replay.name !== undefined ? { cassette: replay.name } : {}),
        ...(trialsCollapsed ? { trialsCollapsed: true as const } : {}),
        ...(cassetteSession?.staleSince !== undefined
          ? { staleSince: cassetteSession.staleSince }
          : {}),
      },
      ...(baselineRef !== undefined ? { baselineRef } : {}),
      variants: variantContexts.map((context) => ({
        name: context.name,
        overrideKeys: context.overrideKeys,
        ...(context.overrides !== undefined
          ? { overrides: context.overrides }
          : {}),
      })),
      perCase: cells,
      aggregates: { perVariant: aggregates },
      ...(comparison !== undefined ? { comparison } : {}),
      gates: {
        passed: overallGatePassed,
        informational: gates.informational,
        results: gates.results,
      },
      passed: overallGatePassed && !erroredCells,
      promote: async (opts?: { id?: string; variant?: string }) => {
        if (filteredRun) {
          throw new Error(
            'filtered runs cannot be promoted — paired baseline statistics need the full case population (spec 03 §4).',
          )
        }
        let variantName = opts?.variant
        if (variantName === undefined) {
          if (selectedVariantNames.length === 1)
            variantName = selectedVariantNames[0]!
          else if (definition.baseline !== undefined)
            variantName = definition.baseline
          else {
            throw new Error(
              `promoting a multi-variant experiment needs a variant — pass { variant } (one of: ${selectedVariantNames.join(', ')}).`,
            )
          }
        } else if (!selectedVariantNames.includes(variantName)) {
          throw new Error(
            `unknown variant '${variantName}' — this experiment ran: ${selectedVariantNames.join(', ')}.`,
          )
        }
        const explicitId = definition.id
        if (explicitId === undefined && opts?.id === undefined) {
          const suggested =
            evaluationId !== '' ? evaluationId : 'your.evaluation.id'
          throw new Error(
            `promotion requires an explicit evaluation id — pin it in source: evaluate('${suggested}', { … }), ` +
              `or pass { id: '${suggested}' } to promote().`,
          )
        }
        const baselineEvaluationId = explicitId ?? opts!.id!
        const record: BaselineRecord = {
          schemaVersion: 1,
          baselineId: ulid(),
          evaluationId: baselineEvaluationId,
          experimentId: experiment.experimentId,
          observability: experiment.observability,
          ...(variantsDeclared ? { variantName } : {}),
          promotedAt: new Date().toISOString(),
          ...(gitUserName(rootDir) !== undefined
            ? { promotedBy: gitUserName(rootDir) }
            : {}),
          configFingerprint,
          reference: buildBaselineReference(cells, variantName),
        }
        const path = await writeBaselineRecord(qualityDir, record)
        return { baselineId: record.baselineId, path }
      },
    }

    if (options.persist !== false) {
      await persistExperiment(experiment, qualityDir)
    }
    evalRun.end({
      attributes: {
        experimentId: experiment.experimentId,
        passed: experiment.passed,
      },
    })
    return experiment
  } catch (error) {
    evalRun.error(error)
    throw error
  }
}
