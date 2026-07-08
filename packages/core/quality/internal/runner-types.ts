/**
 * Internal Quality runner facade contracts.
 *
 * These types describe the first-party tooling boundary. They intentionally
 * speak in collected evaluations, experiments, events, and promotion results
 * instead of leaking engine definitions, path helpers, or cassette internals.
 *
 * @internal
 * @module
 */

import type { ProjectModelDiagnosticCode } from '../../project-index'
import type { QualityDefinitionDiagnosticCode } from './errors'
import type { QualityConfig } from '../config'
import type { EvaluationManifest } from '../manifest'
import type { ReplayMode } from '../replay'
import type { QualitySourceFrameResolver } from '../source-frame'
import type { Evaluation } from '../evaluate'
import type { Comparison, Experiment, ExperimentCell, RunOverrides } from '../experiment'
import type { EngineSetup } from './engine'
import type { EvaluationDefinition } from './definition'
import type { AnyPrompt } from '../../prompt/prompt-types'
import type { FeedbackInput, FeedbackRecord } from './feedback'

interface QualityEvaluationHandleState {
  readonly evaluation: Evaluation
  readonly definition: EvaluationDefinition
}

const qualityEvaluationHandles = new WeakMap<QualityEvaluationHandle, QualityEvaluationHandleState>()

/** Opaque handle to the live evaluation value collected by the facade. */
export interface QualityEvaluationHandle {
  /** Discriminant used for honest runtime checks at the facade boundary. */
  readonly _tag: 'CruxQualityEvaluationHandle'
}

/** Create an opaque facade handle and store engine-only data out of band. @internal */
export function createQualityEvaluationHandle(state: QualityEvaluationHandleState): QualityEvaluationHandle {
  const handle = Object.freeze({
    _tag: 'CruxQualityEvaluationHandle' as const,
  })
  qualityEvaluationHandles.set(handle, state)
  return handle
}

/** Resolve engine-only data for a handle created by this facade. @internal */
export function getQualityEvaluationHandleState(handle: QualityEvaluationHandle): QualityEvaluationHandleState | undefined {
  return qualityEvaluationHandles.get(handle)
}

/** One imported module scanned for exported Quality evaluations. */
export interface QualityEvaluationModule {
  /** POSIX-ish file path relative to the quality root, when known. */
  readonly file?: string
  /** Module namespace object. */
  readonly exports: Record<string, unknown>
}

/** Input for {@link QualityRunner.collect}. */
export interface QualityCollectInput {
  /** Imported modules to scan for `evaluate()` exports. */
  readonly modules?: readonly QualityEvaluationModule[]
  /** Source-discovered prompts whose colocated `tests` should be lowered. */
  readonly promptCandidates?: readonly AnyPrompt[]
  /** Whether duplicate ids should be reported for this collection batch. Default: `true`. */
  readonly validateDuplicateIds?: boolean
}

/** A definition/discovery problem surfaced during collection or execution. */
export interface QualityCollectError {
  readonly message: string
  readonly file?: string
  readonly code?: QualityDefinitionDiagnosticCode
  readonly line?: number
}

/** One collected evaluation, ready to run or promote. */
export interface QualityCollectedEvaluation {
  /** Resolved id: explicit from source, or collection-derived. */
  readonly id: string
  /** Whether the id was explicit in source. Promotion requires a stable id. */
  readonly explicitId: boolean
  /** Defining file relative to the quality root, when available. */
  readonly file: string
  /** Export name (`default`, named export, or `''` for prompt tests). */
  readonly exportName: string
  /** Source channel that produced this evaluation. */
  readonly source: 'file' | 'prompt-tests'
  /** Manifest with collect-time identity fields filled in. */
  readonly manifest: EvaluationManifest
  /** Opaque live handle used by the facade to execute the evaluation. */
  readonly handle: QualityEvaluationHandle
}

/** Result of {@link QualityRunner.collect}. */
export interface QualityCollectResult {
  readonly evaluations: readonly QualityCollectedEvaluation[]
  readonly errors: readonly QualityCollectError[]
}

/** Events emitted by the facade while running or promoting evaluations. */
export type QualityRunnerEvent =
  | {
      type: 'collect:done'
      evaluations: EvaluationManifest[]
      errors: QualityCollectError[]
    }
  | { type: 'eval:start'; evaluationId: string; cells: number }
  | {
      type: 'cell:start'
      evaluationId: string
      caseId: string
      caseName?: string
      variantName: string
      trial: number
    }
  | { type: 'cell:done'; evaluationId: string; cell: ExperimentCell }
  | {
      type: 'eval:done'
      evaluationId: string
      experimentId: string
      configFingerprint: string
      aggregates: Experiment['aggregates']
      gates: Experiment['gates']
      filteredRun: boolean
      replay?: Experiment['replay']
      comparison?: Comparison<string>
      baselineRef?: Experiment['baselineRef']
      recordPath?: string
    }
  | {
      type: 'promote:done'
      evaluationId: string
      experimentId: string
      baselineId: string
      path: string
      variantName?: string
      pinHint?: string
    }
  | { type: 'run:done'; experiments: string[]; exitCode: 0 | 1 | 2 }
  | {
      type: 'error'
      scope: 'collect' | 'execute' | 'promote'
      message: string
      code?: QualityDefinitionDiagnosticCode
      file?: string
      line?: number
    }

/** Receives runner lifecycle events, usually serialized to NDJSON by tooling. */
export type QualityEventSink = (event: QualityRunnerEvent) => void

/** Environment shared by a Quality runner instance. */
export interface QualityRunnerEnv {
  /** Project root used for datasets, source frames, and default persistence. */
  readonly rootDir?: string
  /** Workbench id stored on experiments. */
  readonly qualityId?: string
  /** Quality persistence root. Defaults to `<rootDir>/.crux/quality`. */
  readonly dir?: string
  /** Whether experiment records should be written. Default: `true`. */
  readonly persist?: boolean
  /** Dot-path redaction config. */
  readonly redact?: readonly string[]
  /** Project-config run defaults (`quality.defaults`). */
  readonly defaults?: QualityConfig['defaults']
  /** Output-cache root for watch/rescore flows. */
  readonly cacheDir?: string
  /** Ambient execution providers for model-backed evaluations. */
  readonly setup?: EngineSetup | (() => Promise<EngineSetup | undefined>)
  /** Source-frame resolver, optionally with a custom frame radius. */
  readonly sourceFrames?: QualitySourceFrameResolver | { resolver: QualitySourceFrameResolver; radius?: number }
  /** Event sink for run/promote lifecycle events. */
  readonly events?: QualityEventSink
}

/** Input for {@link QualityRunner.run}. */
export interface QualityRunInput {
  readonly evaluations: readonly QualityCollectedEvaluation[]
  readonly ids?: readonly string[]
  readonly cases?: readonly string[]
  readonly variants?: readonly string[]
  readonly replayMode?: ReplayMode
  readonly reuseOutputs?: boolean
  readonly trials?: number
  readonly concurrency?: number
  readonly experimentLabel?: string
  readonly forceFilteredRun?: boolean
  readonly signal?: AbortSignal
}

/** Result of {@link QualityRunner.run}. */
export interface QualityRunResult {
  readonly exitCode: 0 | 1 | 2
  readonly experimentIds: readonly string[]
  readonly experiments: readonly Experiment<unknown, unknown, string, string>[]
}

/** Input for {@link QualityRunner.promote}. */
export interface QualityPromoteInput {
  readonly evaluations: readonly QualityCollectedEvaluation[]
  readonly experimentId: string
  readonly variant?: string
  readonly pinId?: string
}

/** Baseline metadata returned by {@link QualityRunner.promote}. */
export interface QualityPromotedBaseline {
  readonly evaluationId: string
  readonly experimentId: string
  readonly baselineId: string
  readonly path: string
  readonly variantName?: string
  readonly pinHint?: string
}

/** Result of {@link QualityRunner.promote}. */
export interface QualityPromoteResult {
  readonly exitCode: 0 | 2
  readonly baseline?: QualityPromotedBaseline
}

/** Filters accepted by {@link QualityRunnerFeedback.list}. */
export interface QualityFeedbackListFilter {
  readonly experimentId?: string
  readonly caseId?: string
  readonly tags?: readonly string[]
}

/** Feedback operations exposed through the first-party runner facade. */
export interface QualityRunnerFeedback {
  /** Add one feedback record to the Quality feedback store. */
  add(input: FeedbackInput): Promise<FeedbackRecord>
  /** List feedback records, optionally filtered by experiment, case, and tags. */
  list(filter?: QualityFeedbackListFilter): Promise<readonly FeedbackRecord[]>
}

/** Narrow first-party runner facade for collect, run, and promote operations. */
export interface QualityRunner {
  /** Discover evaluations from modules and prompt-test candidates. */
  collect(input: QualityCollectInput): Promise<QualityCollectResult>
  /** Execute collected evaluations and emit runner lifecycle events. */
  run(input: QualityRunInput): Promise<QualityRunResult>
  /** Promote a persisted experiment into a committed baseline record. */
  promote(input: QualityPromoteInput): Promise<QualityPromoteResult>
  /** Read and write human feedback records for first-party tooling. */
  feedback: QualityRunnerFeedback
}

/** Overrides accepted by the underlying engine; exported for migration only. */
export type QualityRunnerRunOverrides = RunOverrides<string>
