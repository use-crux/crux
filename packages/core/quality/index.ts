/**
 * Local-first quality workbench primitives.
 *
 * `quality()` is the durable development scope for experiments, suites,
 * scores, comparisons, feedback, baselines, and replay metadata. V1 uses a
 * local file-backed store under `.crux/quality` and intentionally does not
 * provide a hosted production analytics backend.
 *
 * @module
 */

'use node'

import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { FlowHandle, FlowRunOptions, FlowResult } from '../flow/types'
import { observe } from '../observability'
import type { Retriever, RetrieverHit, RetrieveOptions } from '../retrieval'
import type {
  ContextEntry,
  MergedInput,
  MiddlewareResult,
  Prompt,
  PromptMiddleware,
  PromptMiddlewareArgs,
} from '../types'
import type { QualityConfig } from './types'
import type { z } from 'zod'
export type { QualityConfig } from './types'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type JsonRecord = { readonly [key: string]: JsonValue }

export type QualitySeverity = 'low' | 'medium' | 'high'

export type QualityScore =
  | {
      readonly kind: 'numeric'
      readonly name: string
      readonly value: number
      readonly passed?: boolean
      readonly threshold?: number
      readonly reasoning?: string
    }
  | {
      readonly kind: 'boolean'
      readonly name: string
      readonly passed: boolean
      readonly reasoning?: string
    }
  | {
      readonly kind: 'categorical'
      readonly name: string
      readonly value: string
      readonly passed?: boolean
      readonly reasoning?: string
    }
  | {
      readonly kind: 'text'
      readonly name: string
      readonly value: string
    }

export interface QualityCaseResult<TInput extends Record<string, unknown>, TOutput> {
  readonly input: TInput
  readonly output: TOutput
}

export interface QualityRetrievalExecution {
  readonly hits: readonly Record<string, unknown>[]
  readonly query?: string
}

export interface QualityToolCallExecution {
  readonly id?: string
  readonly name: string
  readonly args?: unknown
  readonly result?: unknown
}

export interface QualityStepExecution {
  readonly id: string
  readonly name?: string
  readonly status?: string
  readonly output?: unknown
  readonly error?: unknown
  readonly toolCalls: readonly QualityToolCallExecution[]
}

export interface QualityCitationExecution {
  readonly namespace?: string
  readonly sourceId: string
  readonly chunkId?: string
  readonly quote?: string
  readonly url?: string
  readonly path?: string
}

export interface QualityHandoffExecution {
  readonly id?: string
  readonly fromAgent?: string
  readonly toAgent?: string
  readonly reason?: string
  readonly context?: string
  readonly hopNumber?: number
  readonly data?: unknown
  readonly summary?: string
}

export interface QualityArtifactExecution {
  readonly id?: string
  readonly kind?: string
  readonly name?: string
  readonly path?: string
  readonly contentType?: string
  readonly content?: unknown
  readonly preview?: unknown
  readonly metadata?: Record<string, unknown>
}

export interface QualityGuardrailExecution {
  readonly name?: string
  readonly phase?: string
  readonly action: string
  readonly reason?: string
}

export interface QualityConstraintExecution {
  readonly name: string
  readonly severity?: string
  readonly pass?: boolean
  readonly feedback?: string
  readonly attempts?: number
}

export interface QualitySafetyExecution {
  readonly guardrails: readonly QualityGuardrailExecution[]
  readonly constraints: readonly QualityConstraintExecution[]
}

export interface QualityMemoryExecution {
  readonly operation: string
  readonly memoryId?: string
  readonly blockId?: string
  readonly key?: string
  readonly value?: unknown
  readonly summary?: string
}

export interface QualityWorkspaceExecution {
  readonly operation: string
  readonly path?: string
  readonly status?: string
  readonly resultKind?: string
}

export interface QualityRoutingTierExecution {
  readonly tier?: number
  readonly model?: string
  readonly verdict?: string
  readonly confidence?: number
}

export interface QualityRoutingExecution {
  readonly routingKind?: string
  readonly chosen?: string
  readonly classifiedAs?: string
  readonly selectedModel?: string
  readonly fallbackReason?: string
  readonly tiers: readonly QualityRoutingTierExecution[]
}

export interface QualityExpectationContext<TInput extends Record<string, unknown>, TOutput> extends QualityCaseResult<
  TInput,
  TOutput
> {
  readonly suiteId: string
  readonly experimentId: string
  readonly caseId: string
  readonly caseName: string
  readonly variantId: string
  readonly targetId: string
  readonly model?: unknown
  readonly settings?: JsonRecord
  readonly traceId?: string
  readonly trace?: unknown
  readonly retrieval: QualityRetrievalExecution
  readonly toolCalls: readonly QualityToolCallExecution[]
  readonly steps: readonly QualityStepExecution[]
  readonly citations: readonly QualityCitationExecution[]
  readonly handoffs: readonly QualityHandoffExecution[]
  readonly artifacts: readonly QualityArtifactExecution[]
  readonly safety: QualitySafetyExecution
  readonly memory: readonly QualityMemoryExecution[]
  readonly workspace: readonly QualityWorkspaceExecution[]
  readonly routing: readonly QualityRoutingExecution[]
}

export type QualityExpectation<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown> = (
  result: QualityExpectationContext<TInput, TOutput>,
) => void | Promise<void>

export interface QualityCase<TInput extends Record<string, unknown>, TOutput = unknown> {
  readonly id: string
  readonly name?: string
  readonly input: TInput
  readonly expect?: QualityExpectation<TInput, TOutput>
  readonly expected?: JsonRecord
  readonly tags?: readonly string[]
  readonly metadata?: JsonRecord
}

export interface QualitySuite<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown> {
  readonly _tag: 'QualitySuite'
  readonly id: string
  readonly description?: string
  readonly cases: readonly QualityCase<TInput, TOutput>[]
  readonly source: SuiteSource
}

export type SuiteSource =
  | { readonly kind: 'code' }
  | { readonly kind: 'json'; readonly path: string }
  | { readonly kind: 'composed'; readonly suiteIds: readonly string[] }

export type SuiteTestFn<TInput extends Record<string, unknown>, TOutput = unknown> = (
  name: string,
  testCase: Omit<QualityCase<TInput, TOutput>, 'id' | 'name'> & { readonly id?: string },
) => void

export type SuiteBuilder<TInput extends Record<string, unknown>, TOutput = unknown> = (
  test: SuiteTestFn<TInput, TOutput>,
) => void

export interface PortableSuiteJson {
  readonly id: string
  readonly description?: string
  readonly cases: readonly {
    readonly id: string
    readonly name?: string
    readonly input: JsonRecord
    readonly expected?: JsonRecord
    readonly tags?: readonly string[]
    readonly metadata?: JsonRecord
  }[]
}

export interface VariantConfig<TInput extends Record<string, unknown>, TOutput> {
  readonly target: QualityTarget<TInput, TOutput>
  readonly model?: unknown
  readonly settings?: JsonRecord
}

export type QualityTarget<TInput extends Record<string, unknown>, TOutput> =
  | QualityExecutableTarget<TInput, TOutput>
  | ((input: TInput) => TOutput | Promise<TOutput>)

export interface QualityExecutableTarget<TInput extends Record<string, unknown>, TOutput> {
  readonly _tag?: 'QualityTarget'
  readonly id: string
  readonly cassetteKind?: CassetteBoundaryKind
  readonly run: (input: TInput) => TOutput | Promise<TOutput>
}

type AnyQualityPrompt = Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>
type PromptQualityInput<TPrompt extends AnyQualityPrompt> =
  TPrompt extends Prompt<infer TOwnInput, z.ZodType | undefined, infer TContexts>
    ? MergedInput<TOwnInput, TContexts>
    : never

export interface PromptQualityTargetConfig<TPrompt extends AnyQualityPrompt, TOutput> {
  readonly id?: string
  readonly prompt: TPrompt
  readonly generate: (prompt: TPrompt, input: PromptQualityInput<TPrompt>) => TOutput | Promise<TOutput>
}

export interface RetrieverQualityTargetOptions<TInput extends Record<string, unknown>> {
  readonly id?: string
  readonly query: (input: TInput) => string
  readonly options?: RetrieveOptions | ((input: TInput) => RetrieveOptions | Promise<RetrieveOptions>)
}

export interface RetrieverQueryInput {
  readonly query: string
  readonly [key: string]: unknown
}

export interface FlowQualityTargetOptions<TCaseInput extends Record<string, unknown>, TFlowInput> {
  readonly id?: string
  readonly input?: (input: TCaseInput) => TFlowInput
  readonly options?:
    | Omit<FlowRunOptions<TFlowInput>, 'input'>
    | ((
        input: TCaseInput,
      ) => Omit<FlowRunOptions<TFlowInput>, 'input'> | Promise<Omit<FlowRunOptions<TFlowInput>, 'input'>>)
}

export interface QualityScorer<TInput extends Record<string, unknown>, TOutput> {
  readonly id: string
  score(result: {
    readonly input: TInput
    readonly output: TOutput
    readonly caseId: string
    readonly variantId: string
  }): QualityScore | Promise<QualityScore>
}

export interface QualityEvaluateOptions<TInput extends Record<string, unknown>, TOutput> {
  readonly id?: string
  readonly suite: QualitySuite<TInput, TOutput>
  readonly target?: QualityTarget<TInput, TOutput>
  readonly variants?: Record<string, VariantConfig<TInput, TOutput>>
  readonly baseline?: string
  readonly scorers?: readonly QualityScorer<TInput, TOutput>[]
  readonly replay?: Cassette
}

export interface ExperimentCaseResult {
  readonly caseId: string
  readonly caseName: string
  readonly variantId: string
  readonly status: 'passed' | 'failed' | 'error'
  readonly input: JsonValue
  readonly output?: JsonValue
  readonly usage?: JsonValue
  readonly cost?: number
  readonly traceId?: string
  readonly scores: readonly QualityScore[]
  readonly assertion?: {
    readonly passed: boolean
    readonly error?: string
  }
  readonly durationMs: number
  readonly error?: string
}

export interface ExperimentRecord {
  readonly _tag: 'Experiment'
  readonly id: string
  readonly qualityId: string
  readonly suite: {
    readonly id: string
    readonly source: SuiteSource
    readonly caseCount: number
    readonly snapshot: readonly JsonValue[]
  }
  readonly baselineVariantId?: string
  readonly variants: readonly {
    readonly id: string
    readonly targetId: string
    readonly definitionFingerprint?: string
    readonly settings?: JsonRecord
  }[]
  readonly startedAt: string
  readonly endedAt: string
  readonly status: 'passed' | 'failed' | 'error'
  readonly summary: {
    readonly total: number
    readonly passed: number
    readonly failed: number
    readonly errored: number
    readonly byVariant: Record<
      string,
      { readonly total: number; readonly passed: number; readonly failed: number; readonly errored: number }
    >
  }
  readonly cases: readonly ExperimentCaseResult[]
}

export type QualityComparisonSideInput =
  | string
  | ExperimentRecord
  | {
      readonly experiment: string | ExperimentRecord
      readonly variantId?: string
      readonly label?: string
    }

export interface QualityCompareOptions {
  readonly id?: string
  readonly baseline: QualityComparisonSideInput
  readonly candidate: QualityComparisonSideInput
  readonly gates?: QualityComparisonGates
}

export interface QualityComparisonGates {
  readonly passRate?: {
    readonly min?: number
    readonly minDelta?: number
  }
  readonly avgDurationMs?: {
    readonly max?: number
    readonly maxDelta?: number
  }
  readonly numericScores?: Record<
    string,
    {
      readonly min?: number
      readonly max?: number
      readonly minDelta?: number
    }
  >
}

export interface QualityGateResult {
  readonly name: string
  readonly passed: boolean
  readonly actual: number
  readonly expected: number
  readonly operator: 'gte' | 'lte'
}

export interface QualityGateSummary {
  readonly status: 'passed' | 'failed'
  readonly results: readonly QualityGateResult[]
}

export interface QualityComparisonSummary {
  readonly experimentId: string
  readonly variantId?: string
  readonly label?: string
  readonly total: number
  readonly passed: number
  readonly failed: number
  readonly errored: number
  readonly passRate: number
  readonly avgDurationMs: number
  readonly numericScores: Record<string, number>
}

export interface QualityComparisonRecord {
  readonly _tag: 'QualityComparison'
  readonly id: string
  readonly qualityId: string
  readonly comparedAt: string
  readonly baseline: QualityComparisonSummary
  readonly candidate: QualityComparisonSummary
  readonly metrics: {
    readonly passRateDelta: number
    readonly avgDurationMsDelta: number
    readonly numericScoreDeltas: Record<
      string,
      { readonly baseline?: number; readonly candidate?: number; readonly delta?: number }
    >
  }
  readonly gates?: QualityGateSummary
  readonly status: 'candidate_better' | 'candidate_worse' | 'same' | 'mixed'
}

export interface QualityPromoteOptions {
  readonly id: string
  readonly experiment: string | ExperimentRecord
  readonly variantId?: string
  readonly label?: string
}

export interface QualityBaselineRecord {
  readonly _tag: 'QualityBaseline'
  readonly id: string
  readonly qualityId: string
  readonly experimentId: string
  readonly variantId?: string
  readonly label?: string
  readonly promotedAt: string
  readonly summary: QualityComparisonSummary
}

export type CassetteMode = 'record' | 'replay' | 'auto' | 'update' | 'ci' | 'off'

export type CassetteBoundaryKind = 'generate' | 'stream' | 'embed' | 'tool' | 'retrieve' | 'http'

export interface CassetteBoundaryPolicy {
  readonly model?: boolean
  readonly tools?: boolean
  readonly retrieval?: boolean
  readonly embeddings?: boolean
  readonly http?: boolean
}

export interface CassetteConfig {
  readonly path: string
  readonly mode: CassetteMode
  readonly replay?: CassetteBoundaryPolicy
  readonly cases?: readonly string[]
  readonly redactionVersion?: string
}

export interface CassetteRequest {
  readonly kind: CassetteBoundaryKind
  readonly targetId?: string
  readonly caseId?: string
  readonly provider?: string
  readonly model?: string
  readonly inputHash: string
  readonly promptHash?: string
  readonly settingsHash?: string
  readonly toolSchemaHash?: string
}

export interface CassetteEntry {
  readonly id: string
  readonly caseId?: string
  readonly traceId?: string
  readonly request: CassetteRequest
  readonly response: {
    readonly output?: JsonValue
    readonly streamChunks?: readonly { readonly delta: string; readonly offsetMs?: number }[]
    readonly toolCalls?: readonly JsonValue[]
    readonly usage?: JsonValue
    readonly cost?: number
    readonly error?: { readonly name?: string; readonly message: string; readonly stack?: string }
  }
  readonly recordedAt: string
  readonly redactionVersion: string
}

export interface CassetteFile {
  readonly _tag: 'Cassette'
  readonly version: 1
  readonly entries: readonly CassetteEntry[]
}

export interface Cassette {
  readonly _tag: 'Cassette'
  readonly path: string
  readonly mode: CassetteMode
  readonly replay: Required<CassetteBoundaryPolicy>
  readonly cases?: readonly string[]
  run<TOutput>(request: CassetteRequest, execute: () => Promise<TOutput>): Promise<TOutput>
}

export interface CassetteMiddlewareOptions {
  readonly targetId?: string | ((args: PromptMiddlewareArgs) => string | undefined)
  readonly caseId?: string | ((args: PromptMiddlewareArgs) => string | undefined)
}

export class CassetteReplayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CassetteReplayError'
  }
}

export type QualityFeedbackStatus = 'new' | 'reviewed' | 'dismissed'

export interface QualityFeedbackInput {
  readonly traceId?: string
  readonly experimentId?: string
  readonly caseId?: string
  readonly rating?: -1 | 0 | 1
  readonly comment?: string
  readonly expected?: JsonRecord
  readonly tags?: readonly string[]
  readonly metadata?: JsonRecord
}

export interface QualityFeedbackRecord {
  readonly _tag: 'QualityFeedback'
  readonly id: string
  readonly qualityId: string
  readonly createdAt: string
  readonly status: QualityFeedbackStatus
  readonly traceId?: string
  readonly experimentId?: string
  readonly caseId?: string
  readonly rating?: -1 | 0 | 1
  readonly comment?: string
  readonly expected?: JsonRecord
  readonly tags?: readonly string[]
  readonly metadata?: JsonRecord
}

export interface QualityFeedbackAnnotationInput {
  readonly feedbackId: string
  readonly status?: QualityFeedbackStatus
  readonly note?: string
  readonly expected?: JsonRecord
  readonly tags?: readonly string[]
  readonly metadata?: JsonRecord
}

export interface QualityFeedbackAnnotationRecord {
  readonly _tag: 'QualityFeedbackAnnotation'
  readonly id: string
  readonly qualityId: string
  readonly feedbackId: string
  readonly createdAt: string
  readonly status?: QualityFeedbackStatus
  readonly note?: string
  readonly expected?: JsonRecord
  readonly tags?: readonly string[]
  readonly metadata?: JsonRecord
}

export interface QualityFeedbackMemoryProposalInput {
  readonly feedbackId: string
  readonly memoryId?: string
  readonly memoryKind?: string
  readonly proposal: JsonRecord
  readonly reason?: string
  readonly tags?: readonly string[]
  readonly metadata?: JsonRecord
}

export interface QualityFeedbackMemoryProposalRecord {
  readonly _tag: 'QualityFeedbackMemoryProposal'
  readonly id: string
  readonly qualityId: string
  readonly feedbackId: string
  readonly createdAt: string
  readonly status: 'proposed'
  readonly memoryId?: string
  readonly memoryKind?: string
  readonly proposal: JsonRecord
  readonly reason?: string
  readonly tags?: readonly string[]
  readonly metadata?: JsonRecord
}

export interface QualityFeedbackSuiteOptions {
  readonly id: string
  readonly description?: string
  readonly feedbackIds: readonly string[]
  readonly inputs?: Record<string, JsonRecord>
  readonly tag?: string
  readonly includeFeedbackMetadata?: boolean
}

export interface QualityFeedbackWriteSuiteOptions extends QualityFeedbackSuiteOptions {
  readonly path: string
}

export interface QualityFeedbackApi {
  record(input: QualityFeedbackInput): Promise<QualityFeedbackRecord>
  list(): Promise<readonly QualityFeedbackRecord[]>
  annotate(input: QualityFeedbackAnnotationInput): Promise<QualityFeedbackAnnotationRecord>
  listAnnotations(feedbackId?: string): Promise<readonly QualityFeedbackAnnotationRecord[]>
  proposeMemory(input: QualityFeedbackMemoryProposalInput): Promise<QualityFeedbackMemoryProposalRecord>
  listMemoryProposals(feedbackId?: string): Promise<readonly QualityFeedbackMemoryProposalRecord[]>
  exportSuite(options: QualityFeedbackSuiteOptions): Promise<PortableSuiteJson>
  writeSuite(options: QualityFeedbackWriteSuiteOptions): Promise<PortableSuiteJson>
}

export interface Quality {
  readonly _tag: 'Quality'
  readonly id: string
  readonly dir: string
  evaluate<TInput extends Record<string, unknown>, TOutput>(
    options: QualityEvaluateOptions<TInput, TOutput>,
  ): Promise<ExperimentRecord>
  getExperiment(id: string): Promise<ExperimentRecord | null>
  listExperiments(): Promise<readonly ExperimentRecord[]>
  compare(options: QualityCompareOptions): Promise<QualityComparisonRecord>
  getComparison(id: string): Promise<QualityComparisonRecord | null>
  listComparisons(): Promise<readonly QualityComparisonRecord[]>
  promote(options: QualityPromoteOptions): Promise<QualityBaselineRecord>
  getBaseline(id: string): Promise<QualityBaselineRecord | null>
  listBaselines(): Promise<readonly QualityBaselineRecord[]>
  readonly feedback: QualityFeedbackApi
}

function createQualityTarget<TInput extends Record<string, unknown>, TOutput>(
  config: QualityExecutableTarget<TInput, TOutput>,
): QualityExecutableTarget<TInput, TOutput> {
  if (!config.id.trim()) throw new Error('target(): id must be non-empty.')
  return Object.freeze({ ...config, _tag: 'QualityTarget' as const })
}

function promptTarget<TPrompt extends AnyQualityPrompt, TOutput>(
  config: PromptQualityTargetConfig<TPrompt, TOutput>,
): QualityExecutableTarget<PromptQualityInput<TPrompt>, TOutput> {
  const id = config.id ?? config.prompt.id
  if (!id?.trim()) throw new Error('target.prompt(): prompt id is required when target id is omitted.')
  return createQualityTarget({
    id,
    cassetteKind: 'generate',
    run: (input) => config.generate(config.prompt, input),
  })
}

function retrieverTarget<TInput extends RetrieverQueryInput>(
  retriever: Retriever,
  options?: Omit<RetrieverQualityTargetOptions<TInput>, 'query'>,
): QualityExecutableTarget<TInput, readonly RetrieverHit[]>
function retrieverTarget<TInput extends Record<string, unknown>>(
  retriever: Retriever,
  options: RetrieverQualityTargetOptions<TInput>,
): QualityExecutableTarget<TInput, readonly RetrieverHit[]>
function retrieverTarget<TInput extends Record<string, unknown>>(
  retriever: Retriever,
  options?: RetrieverQualityTargetOptions<TInput> | Omit<RetrieverQualityTargetOptions<RetrieverQueryInput>, 'query'>,
): QualityExecutableTarget<TInput, readonly RetrieverHit[]> {
  const id = options?.id ?? retriever.id
  if (!id.trim()) throw new Error('target.retriever(): id must be non-empty.')
  return createQualityTarget({
    id,
    cassetteKind: 'retrieve',
    run: async (input) => {
      const query =
        'query' in (options ?? {})
          ? (options as RetrieverQualityTargetOptions<TInput>).query(input)
          : getDefaultRetrieverQuery(input)
      const retrieveOptions = await resolveRetrieverOptions(
        options?.options as RetrieverQualityTargetOptions<TInput>['options'] | undefined,
        input,
      )
      return retriever.retrieve(query, retrieveOptions)
    },
  })
}

function flowTarget<TOutput, TInput extends Record<string, unknown>>(
  flowHandle: FlowHandle<TOutput, TInput>,
  options?: FlowQualityTargetOptions<TInput, TInput>,
): QualityExecutableTarget<TInput, TOutput>
function flowTarget<TOutput, TFlowInput, TCaseInput extends Record<string, unknown>>(
  flowHandle: FlowHandle<TOutput, TFlowInput>,
  options: FlowQualityTargetOptions<TCaseInput, TFlowInput> & {
    readonly input: (input: TCaseInput) => TFlowInput
  },
): QualityExecutableTarget<TCaseInput, TOutput>
function flowTarget<TOutput, TFlowInput, TCaseInput extends Record<string, unknown>>(
  flowHandle: FlowHandle<TOutput, TFlowInput>,
  options?: FlowQualityTargetOptions<TCaseInput, TFlowInput>,
): QualityExecutableTarget<TCaseInput, TOutput> {
  const id = options?.id ?? flowHandle.name
  if (!id.trim()) throw new Error('target.flow(): id must be non-empty.')
  return createQualityTarget({
    id,
    cassetteKind: 'generate',
    run: async (input) => {
      const mappedInput = options?.input ? options.input(input) : (input as unknown as TFlowInput)
      const flowOptions = await resolveFlowOptions(options?.options, input)
      const result = await flowHandle.run({ ...flowOptions, input: mappedInput })
      return unwrapCompletedFlowResult(result, flowHandle.name)
    },
  })
}

export const target = Object.assign(createQualityTarget, {
  custom: createQualityTarget,
  prompt: promptTarget,
  retriever: retrieverTarget,
  flow: flowTarget,
})

function getDefaultRetrieverQuery<TInput extends Record<string, unknown>>(input: TInput): string {
  const query = input.query
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('target.retriever(): case input must include a non-empty "query" string or provide options.query.')
  }
  return query
}

async function resolveRetrieverOptions<TInput extends Record<string, unknown>>(
  options: RetrieverQualityTargetOptions<TInput>['options'] | undefined,
  input: TInput,
): Promise<RetrieveOptions | undefined> {
  if (!options) return undefined
  return typeof options === 'function' ? options(input) : options
}

async function resolveFlowOptions<TCaseInput extends Record<string, unknown>, TFlowInput>(
  options: FlowQualityTargetOptions<TCaseInput, TFlowInput>['options'] | undefined,
  input: TCaseInput,
): Promise<Omit<FlowRunOptions<TFlowInput>, 'input'> | undefined> {
  if (!options) return undefined
  return typeof options === 'function' ? options(input) : options
}

function unwrapCompletedFlowResult<TOutput>(result: FlowResult<TOutput>, name: string): TOutput {
  if (result.status === 'completed') return result.output
  throw new Error(`target.flow(): flow "${name}" ended with status "${result.status}" instead of "completed".`)
}

function createSuite<TInput extends Record<string, unknown>, TOutput = unknown>(
  id: string,
  define: SuiteBuilder<TInput, TOutput>,
): QualitySuite<TInput, TOutput> {
  if (!id.trim()) throw new Error('suite(): id must be non-empty.')
  const cases: QualityCase<TInput, TOutput>[] = []
  const seen = new Set<string>()

  const test: SuiteTestFn<TInput, TOutput> = (name, testCase) => {
    const caseId = testCase.id ?? slugify(name)
    if (!caseId.trim()) throw new Error('suite(): case id must be non-empty.')
    if (seen.has(caseId)) throw new Error(`suite(): duplicate case id "${caseId}".`)
    seen.add(caseId)
    cases.push(Object.freeze({ ...testCase, id: caseId, name }))
  }

  define(test)
  if (cases.length === 0) throw new Error('suite(): cases must be non-empty.')

  return Object.freeze({
    _tag: 'QualitySuite' as const,
    id,
    cases: Object.freeze([...cases]),
    source: Object.freeze({ kind: 'code' as const }),
  })
}

async function jsonSuite(path: string): Promise<QualitySuite<Record<string, unknown>, unknown>> {
  const raw = await readFile(path, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  if (!isPortableSuiteJson(parsed)) throw new Error(`suite.json(): invalid suite at ${path}.`)
  return Object.freeze({
    _tag: 'QualitySuite' as const,
    id: parsed.id,
    description: parsed.description,
    cases: Object.freeze(
      parsed.cases.map((testCase) =>
        Object.freeze({
          id: testCase.id,
          name: testCase.name,
          input: { ...testCase.input },
          expected: testCase.expected,
          tags: testCase.tags,
          metadata: testCase.metadata,
        }),
      ),
    ),
    source: Object.freeze({ kind: 'json' as const, path }),
  })
}

function composeSuites<const TSets extends readonly QualitySuite<Record<string, unknown>, unknown>[]>(
  suites: TSets,
): QualitySuite<Record<string, unknown>, unknown> {
  if (suites.length === 0) throw new Error('suite.compose(): suites must be non-empty.')
  const id = suites.map((item) => item.id).join('+')
  const cases: QualityCase<Record<string, unknown>>[] = []
  const seen = new Set<string>()
  for (const item of suites) {
    for (const testCase of item.cases) {
      const caseId = `${item.id}:${testCase.id}`
      if (seen.has(caseId)) throw new Error(`suite.compose(): duplicate case id "${caseId}".`)
      seen.add(caseId)
      cases.push(Object.freeze({ ...testCase, id: caseId }))
    }
  }
  return Object.freeze({
    _tag: 'QualitySuite' as const,
    id,
    cases: Object.freeze(cases),
    source: Object.freeze({
      kind: 'composed' as const,
      suiteIds: Object.freeze(suites.map((item) => item.id)),
    }),
  })
}

function suiteToJSON<TInput extends Record<string, unknown>, TOutput>(
  input: QualitySuite<TInput, TOutput>,
): PortableSuiteJson {
  return Object.freeze({
    id: input.id,
    ...(input.description ? { description: input.description } : {}),
    cases: Object.freeze(
      input.cases.map((testCase) =>
        Object.freeze({
          id: testCase.id,
          ...(testCase.name ? { name: testCase.name } : {}),
          input: toJsonRecord(testCase.input, `suite.toJSON(): case "${testCase.id}" input`),
          ...(testCase.expected ? { expected: testCase.expected } : {}),
          ...(testCase.tags ? { tags: Object.freeze([...testCase.tags]) } : {}),
          ...(testCase.metadata ? { metadata: testCase.metadata } : {}),
        }),
      ),
    ),
  })
}

async function writeJsonSuite<TInput extends Record<string, unknown>>(
  input: QualitySuite<TInput, unknown>,
  path: string,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(suiteToJSON(input), null, 2)}\n`)
}

function createCassette(config: CassetteConfig): Cassette {
  if (config.mode !== 'off' && !config.path.trim()) throw new Error('cassette(): path must be non-empty.')
  const replay = normalizeCassetteBoundaryPolicy(config.replay)
  return Object.freeze({
    _tag: 'Cassette' as const,
    path: config.path,
    mode: config.mode,
    replay,
    ...(config.cases ? { cases: Object.freeze([...config.cases]) } : {}),
    run: async <TOutput>(request: CassetteRequest, execute: () => Promise<TOutput>): Promise<TOutput> => {
      if (config.mode === 'off' || !cassetteBoundaryEnabled(replay, request.kind)) return execute()
      return runCassetteBoundary(config, request, execute)
    },
  })
}

function normalizeCassetteBoundaryPolicy(policy?: CassetteBoundaryPolicy): Required<CassetteBoundaryPolicy> {
  return {
    model: policy?.model ?? true,
    tools: policy?.tools ?? true,
    retrieval: policy?.retrieval ?? true,
    embeddings: policy?.embeddings ?? false,
    http: policy?.http ?? true,
  }
}

function cassetteBoundaryEnabled(policy: Required<CassetteBoundaryPolicy>, kind: CassetteBoundaryKind): boolean {
  if (kind === 'generate' || kind === 'stream') return policy.model
  if (kind === 'tool') return policy.tools
  if (kind === 'retrieve') return policy.retrieval
  if (kind === 'embed') return policy.embeddings
  return policy.http
}

export const suite = Object.assign(createSuite, {
  json: jsonSuite,
  compose: composeSuites,
  toJSON: suiteToJSON,
  writeJSON: writeJsonSuite,
})

export interface ExpectedRetrievalHit {
  readonly namespace?: string
  readonly sourceId?: string
  readonly chunkId?: string
  readonly metadata?: JsonRecord
}

export interface ExpectedToolCall {
  readonly args?: JsonRecord
  readonly result?: unknown
}

export interface QualityValueMatchers<TValue> {
  toBe(expected: TValue): void
  toEqual(expected: unknown): void
  toStrictEqual(expected: unknown): void
  toContain(expected: string | readonly string[]): void
  toContainEqual(expected: unknown): void
  toMatch(pattern: RegExp | string): void
  toMatchObject(expected: Record<string, unknown>): void
  toBeGreaterThan(expected: number | bigint): void
  toBeGreaterThanOrEqual(expected: number | bigint): void
  toBeLessThan(expected: number | bigint): void
  toBeLessThanOrEqual(expected: number | bigint): void
  toBeDefined(): void
  toBeUndefined(): void
  toBeNull(): void
  toBeTruthy(): void
  toBeFalsy(): void
  toBeNaN(): void
  toHaveLength(expected: number): void
  toHaveProperty(path: string | readonly PropertyKey[], expected?: unknown): void
  toBeTypeOf(expected: QualityTypeName): void
  toBeInstanceOf(expected: abstract new (...args: readonly unknown[]) => unknown): void
  toThrow(expected?: QualityThrowExpectation): void
  toSatisfy(predicate: (value: TValue) => boolean, message?: string): void
  readonly resolves: QualityAsyncValueMatchers<Awaited<TValue>>
  readonly rejects: QualityAsyncValueMatchers<unknown>
  readonly not: QualityValueMatchers<TValue>
}

export interface QualityAsyncValueMatchers<TValue> {
  toBe(expected: TValue): Promise<void>
  toEqual(expected: unknown): Promise<void>
  toStrictEqual(expected: unknown): Promise<void>
  toContain(expected: string | readonly string[]): Promise<void>
  toContainEqual(expected: unknown): Promise<void>
  toMatch(pattern: RegExp | string): Promise<void>
  toMatchObject(expected: Record<string, unknown>): Promise<void>
  toBeGreaterThan(expected: number | bigint): Promise<void>
  toBeGreaterThanOrEqual(expected: number | bigint): Promise<void>
  toBeLessThan(expected: number | bigint): Promise<void>
  toBeLessThanOrEqual(expected: number | bigint): Promise<void>
  toBeDefined(): Promise<void>
  toBeUndefined(): Promise<void>
  toBeNull(): Promise<void>
  toBeTruthy(): Promise<void>
  toBeFalsy(): Promise<void>
  toBeNaN(): Promise<void>
  toHaveLength(expected: number): Promise<void>
  toHaveProperty(path: string | readonly PropertyKey[], expected?: unknown): Promise<void>
  toBeTypeOf(expected: QualityTypeName): Promise<void>
  toBeInstanceOf(expected: abstract new (...args: readonly unknown[]) => unknown): Promise<void>
  toThrow(expected?: QualityThrowExpectation): Promise<void>
  toSatisfy(predicate: (value: TValue) => boolean | Promise<boolean>, message?: string): Promise<void>
  readonly not: QualityAsyncValueMatchers<TValue>
}

export type QualityThrowExpectation = string | RegExp | QualityErrorConstructor

export interface QualityErrorConstructor {
  new (message?: string): Error
  readonly name?: string
}

export type QualityTypeName =
  | 'bigint'
  | 'boolean'
  | 'function'
  | 'number'
  | 'object'
  | 'string'
  | 'symbol'
  | 'undefined'

export interface QualityRetrievalMatchers {
  toContainHit(expected: ExpectedRetrievalHit): void
  toHaveHitCount(count: number): void
  toHaveMinHitCount(count: number): void
  toHaveMaxHitCount(count: number): void
  toHaveTopHit(expected: ExpectedRetrievalHit): void
}

export interface QualityToolCallMatchers {
  toHaveCalled(name: string, expected?: ExpectedToolCall): void
  toHaveCalledTimes(name: string, count: number): void
  toHaveCalledWith(name: string, args: unknown): void
  toHaveReturned(name: string): void
  toHaveReturnedWith(name: string, result: unknown): void
  toHaveFailed(name: string): void
  toHaveCallSequence(names: readonly string[]): void
  toHaveNoUnexpectedCalls(allowedNames: readonly string[]): void
}

export interface QualityOutputMatchers {
  toMatchSchema(schema: QualitySchema): void
  toHaveField(path: string | readonly PropertyKey[], expected?: unknown): void
  toHaveNoField(path: string | readonly PropertyKey[]): void
}

export interface QualitySchema {
  safeParse(value: unknown): { readonly success: boolean; readonly error?: unknown }
}

export interface QualityStepMatchers {
  toHaveSucceeded(id: string): void
  toHaveStatus(id: string, status: string): void
  toHaveRun(id: string): void
  toHaveFailed(id: string): void
  toHaveStepOrder(ids: readonly string[]): void
  toHaveOutput(id: string, expectedPartial: unknown): void
  toHaveToolCall(id: string, toolName: string): void
}

export interface ExpectedCitation {
  readonly namespace?: string
  readonly sourceId: string
  readonly chunkId?: string
  readonly quote?: string
}

export interface QualityCitationMatchers {
  toContainCitation(expected: ExpectedCitation): void
  toHaveCitationCount(count: number): void
  toHaveCitationForSource(sourceId: string): void
  toHaveAllCitationsResolved(): void
  toHaveNoDanglingCitations(): void
  toHaveMinimumQuoteLength(length: number): void
  toQuoteOutput(): void
}

export interface QualityUsageMatchers {
  toHaveTokenUsageBelow(tokens: number): void
  toHaveCostBelow(cost: number): void
  toHaveModel(model: string): void
  toHaveNoFallback(): void
  toHaveUsedFallback(): void
}

export interface ExpectedHandoff {
  readonly id?: string
  readonly fromAgent?: string
  readonly toAgent?: string
  readonly reason?: string
  readonly hopNumber?: number
}

export interface QualityHandoffMatchers {
  toHaveHandoff(expected: ExpectedHandoff): void
  toHaveHandoffPath(path: readonly string[]): void
  toHaveHandoffCount(count: number): void
}

export interface ExpectedArtifact {
  readonly id?: string
  readonly kind?: string
  readonly name?: string
  readonly path?: string
  readonly contentType?: string
  readonly metadata?: Record<string, unknown>
}

export interface QualityArtifactMatchers {
  toHaveArtifact(expected: ExpectedArtifact): void
  toHaveArtifactKind(kind: string): void
  toHaveArtifactPath(path: string): void
  toHaveArtifactCount(count: number): void
  toHaveArtifactContent(pathOrName: string, expected: string | RegExp | unknown): void
}

export interface QualitySafetyMatchers {
  toHaveGuardrailAction(name: string, action: string): void
  toHaveBlockedGuardrail(name?: string): void
  toHaveNoBlockedGuardrails(): void
  toHaveConstraintPassed(name: string): void
  toHaveConstraintFailed(name: string): void
  toHaveAllConstraintsPassed(): void
  toHaveConstraintRetry(name?: string): void
}

export interface ExpectedMemoryOperation {
  readonly operation?: string
  readonly memoryId?: string
  readonly blockId?: string
  readonly key?: string
}

export interface QualityMemoryMatchers {
  toHaveMemoryOperation(expected: ExpectedMemoryOperation): void
  toHaveRead(expected?: Omit<ExpectedMemoryOperation, 'operation'>): void
  toHaveWritten(expected?: Omit<ExpectedMemoryOperation, 'operation'>): void
  toHaveMemoryValue(keyOrBlockId: string, expected: unknown): void
}

export interface ExpectedWorkspaceOperation {
  readonly operation?: string
  readonly path?: string
  readonly status?: string
  readonly resultKind?: string
}

export interface QualityWorkspaceMatchers {
  toHaveWorkspaceOperation(expected: ExpectedWorkspaceOperation): void
  toHaveRead(path: string): void
  toHaveWritten(path: string): void
  toHaveDeleted(path: string): void
  toHaveListed(path?: string): void
  toHaveNoWritesOutside(allowedPaths: readonly string[]): void
}

export interface QualityRoutingMatchers {
  toHaveRoutingKind(kind: string): void
  toHaveSelectedRoute(route: string): void
  toHaveClassifiedAs(label: string): void
  toHaveSelectedModel(model: string): void
  toHaveFallbackReason(reason: string | RegExp): void
  toHaveTierVerdict(model: string, verdict: string): void
}

export interface QualityExpectApi {
  <const TValue>(actual: TValue): QualityValueMatchers<TValue>
  all<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown>(
    ...expectations: readonly QualityExpectation<TInput, TOutput>[]
  ): QualityExpectation<TInput, TOutput>
  retrieval(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): QualityRetrievalMatchers
  output(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): QualityOutputMatchers
  toolCalls(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): QualityToolCallMatchers
  steps(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): QualityStepMatchers
  citations(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): QualityCitationMatchers
  usage(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): QualityUsageMatchers
  handoffs(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): QualityHandoffMatchers
  artifacts(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): QualityArtifactMatchers
  safety(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): QualitySafetyMatchers
  memory(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): QualityMemoryMatchers
  workspace(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): QualityWorkspaceMatchers
  routing(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): QualityRoutingMatchers
}

function createValueMatchers<TValue>(actual: TValue, negated = false): QualityValueMatchers<TValue> {
  const check = (passed: boolean, message: string, negatedMessage?: string): void => {
    if (negated ? passed : !passed) throw new Error(negated && negatedMessage ? negatedMessage : message)
  }
  const matchers: Omit<QualityValueMatchers<TValue>, 'not' | 'resolves' | 'rejects'> = {
    toBe(expected) {
      const actualText = stringifyForAssertion(toJsonValue(actual))
      const expectedText = stringifyForAssertion(toJsonValue(expected))
      check(
        Object.is(actual, expected),
        `Expected ${actualText} to be ${expectedText}.`,
        `Expected ${actualText} not to be ${expectedText}.`,
      )
    },
    toEqual(expected) {
      const actualText = stringifyForAssertion(toJsonValue(actual))
      const expectedText = stringifyForAssertion(toJsonValue(expected))
      check(
        stableJson(toJsonValue(actual)) === stableJson(toJsonValue(expected)),
        `Expected ${actualText} to equal ${expectedText}.`,
        `Expected ${actualText} not to equal ${expectedText}.`,
      )
    },
    toStrictEqual(expected) {
      const actualText = stringifyForAssertion(toJsonValue(actual))
      const expectedText = stringifyForAssertion(toJsonValue(expected))
      check(
        isDeepStrictEqual(actual, expected),
        `Expected ${actualText} to strictly equal ${expectedText}.`,
        `Expected ${actualText} not to strictly equal ${expectedText}.`,
      )
    },
    toContain(expected) {
      const values = typeof expected === 'string' ? [expected] : expected
      const text = stringifyForAssertion(toJsonValue(actual))
      for (const value of values) {
        check(
          text.includes(value),
          `Expected ${text} to contain "${value}".`,
          `Expected ${text} not to contain "${value}".`,
        )
      }
    },
    toContainEqual(expected) {
      if (!Array.isArray(actual)) {
        throw new Error(`Expected actual value to be an array, got ${stringifyForAssertion(toJsonValue(actual))}.`)
      }
      const expectedJson = toJsonValue(expected)
      const expectedText = stringifyForAssertion(expectedJson)
      check(
        actual.some((item) => stableJson(toJsonValue(item)) === stableJson(expectedJson)),
        `Expected ${stringifyForAssertion(toJsonValue(actual))} to contain equal value ${expectedText}.`,
        `Expected ${stringifyForAssertion(toJsonValue(actual))} not to contain equal value ${expectedText}.`,
      )
    },
    toMatch(pattern) {
      const text = stringifyForAssertion(toJsonValue(actual))
      const matcher = typeof pattern === 'string' ? new RegExp(pattern) : pattern
      check(
        matcher.test(text),
        `Expected ${text} to match ${matcher.toString()}.`,
        `Expected ${text} not to match ${matcher.toString()}.`,
      )
    },
    toMatchObject(expected) {
      assertRecord(actual, 'actual value')
      check(
        objectContains(actual, expected),
        `Expected ${stringifyForAssertion(toJsonValue(actual))} to match object ${stringifyForAssertion(toJsonValue(expected))}.`,
        `Expected ${stringifyForAssertion(toJsonValue(actual))} not to match object ${stringifyForAssertion(toJsonValue(expected))}.`,
      )
    },
    toBeGreaterThan(expected) {
      checkNumericComparison(
        actual,
        expected,
        '>',
        (actualValue, expectedValue) => actualValue > expectedValue,
        negated,
      )
    },
    toBeGreaterThanOrEqual(expected) {
      checkNumericComparison(
        actual,
        expected,
        '>=',
        (actualValue, expectedValue) => actualValue >= expectedValue,
        negated,
      )
    },
    toBeLessThan(expected) {
      checkNumericComparison(
        actual,
        expected,
        '<',
        (actualValue, expectedValue) => actualValue < expectedValue,
        negated,
      )
    },
    toBeLessThanOrEqual(expected) {
      checkNumericComparison(
        actual,
        expected,
        '<=',
        (actualValue, expectedValue) => actualValue <= expectedValue,
        negated,
      )
    },
    toBeDefined() {
      check(actual !== undefined, 'Expected value to be defined.', 'Expected value not to be defined.')
    },
    toBeUndefined() {
      const actualText = stringifyForAssertion(toJsonValue(actual))
      check(
        actual === undefined,
        `Expected ${actualText} to be undefined.`,
        `Expected ${actualText} not to be undefined.`,
      )
    },
    toBeNull() {
      const actualText = stringifyForAssertion(toJsonValue(actual))
      check(actual === null, `Expected ${actualText} to be null.`, `Expected ${actualText} not to be null.`)
    },
    toBeTruthy() {
      const actualText = stringifyForAssertion(toJsonValue(actual))
      check(Boolean(actual), `Expected ${actualText} to be truthy.`, `Expected ${actualText} not to be truthy.`)
    },
    toBeFalsy() {
      const actualText = stringifyForAssertion(toJsonValue(actual))
      check(!actual, `Expected ${actualText} to be falsy.`, `Expected ${actualText} not to be falsy.`)
    },
    toBeNaN() {
      const passed = typeof actual === 'number' && Number.isNaN(actual)
      check(passed, 'Expected value to be NaN.', 'Expected value not to be NaN.')
    },
    toHaveLength(expected) {
      const length = valueLength(actual)
      check(
        length === expected,
        `Expected ${stringifyForAssertion(toJsonValue(actual))} to have length ${expected}, got ${lengthText(length)}.`,
        `Expected ${stringifyForAssertion(toJsonValue(actual))} not to have length ${expected}.`,
      )
    },
    toHaveProperty(path, expected) {
      const actualPath = propertyPath(path)
      const resolved = getPropertyPath(actual, actualPath)
      const pathText = formatPropertyPath(actualPath)
      const hasExpected = arguments.length > 1
      if (!hasExpected) {
        check(
          resolved.exists,
          `Expected ${stringifyForAssertion(toJsonValue(actual))} to have property ${pathText}.`,
          `Expected ${stringifyForAssertion(toJsonValue(actual))} not to have property ${pathText}.`,
        )
        return
      }
      check(
        resolved.exists && stableJson(toJsonValue(resolved.value)) === stableJson(toJsonValue(expected)),
        `Expected property ${pathText} to equal ${stringifyForAssertion(toJsonValue(expected))}.`,
        `Expected property ${pathText} not to equal ${stringifyForAssertion(toJsonValue(expected))}.`,
      )
    },
    toBeTypeOf(expected) {
      const actualType = typeof actual
      check(
        actualType === expected,
        `Expected ${stringifyForAssertion(toJsonValue(actual))} to be type ${expected}, got ${actualType}.`,
        `Expected ${stringifyForAssertion(toJsonValue(actual))} not to be type ${expected}.`,
      )
    },
    toBeInstanceOf(expected) {
      const expectedName = expected.name || 'provided constructor'
      check(
        actual instanceof expected,
        `Expected value to be instance of ${expectedName}.`,
        `Expected value not to be instance of ${expectedName}.`,
      )
    },
    toThrow(expected) {
      if (typeof actual !== 'function') {
        throw new Error(`Expected actual value to be a function, got ${stringifyForAssertion(toJsonValue(actual))}.`)
      }
      const thrown = captureThrown(actual as () => unknown)
      const passed = thrown.threw && (expected === undefined || thrownMatches(thrown.error, expected))
      const expectedText = expected === undefined ? '' : ` matching ${formatThrowExpectation(expected)}`
      check(passed, `Expected function to throw${expectedText}.`, `Expected function not to throw${expectedText}.`)
    },
    toSatisfy(predicate, message) {
      const actualText = stringifyForAssertion(toJsonValue(actual))
      check(
        predicate(actual),
        message ?? `Expected ${actualText} to satisfy predicate.`,
        message ?? `Expected ${actualText} not to satisfy predicate.`,
      )
    },
  }
  return Object.freeze({
    ...matchers,
    get resolves() {
      return createAsyncValueMatchers<Awaited<TValue>>(actual, 'resolves')
    },
    get rejects() {
      return createAsyncValueMatchers<unknown>(actual, 'rejects')
    },
    get not() {
      return createValueMatchers(actual, !negated)
    },
  })
}

type AsyncExpectationMode = 'resolves' | 'rejects'

function createAsyncValueMatchers<TValue>(
  actual: unknown,
  mode: AsyncExpectationMode,
  negated = false,
): QualityAsyncValueMatchers<TValue> {
  const withResolvedValue = async (run: (value: TValue) => void): Promise<void> => {
    const value = (await settleAsyncExpectation(actual, mode)) as TValue
    run(value)
  }
  const matchers: Omit<QualityAsyncValueMatchers<TValue>, 'not'> = {
    async toBe(expected) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toBe(expected))
    },
    async toEqual(expected) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toEqual(expected))
    },
    async toStrictEqual(expected) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toStrictEqual(expected))
    },
    async toContain(expected) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toContain(expected))
    },
    async toContainEqual(expected) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toContainEqual(expected))
    },
    async toMatch(pattern) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toMatch(pattern))
    },
    async toMatchObject(expected) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toMatchObject(expected))
    },
    async toBeGreaterThan(expected) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toBeGreaterThan(expected))
    },
    async toBeGreaterThanOrEqual(expected) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toBeGreaterThanOrEqual(expected))
    },
    async toBeLessThan(expected) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toBeLessThan(expected))
    },
    async toBeLessThanOrEqual(expected) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toBeLessThanOrEqual(expected))
    },
    async toBeDefined() {
      await withResolvedValue((value) => createValueMatchers(value, negated).toBeDefined())
    },
    async toBeUndefined() {
      await withResolvedValue((value) => createValueMatchers(value, negated).toBeUndefined())
    },
    async toBeNull() {
      await withResolvedValue((value) => createValueMatchers(value, negated).toBeNull())
    },
    async toBeTruthy() {
      await withResolvedValue((value) => createValueMatchers(value, negated).toBeTruthy())
    },
    async toBeFalsy() {
      await withResolvedValue((value) => createValueMatchers(value, negated).toBeFalsy())
    },
    async toBeNaN() {
      await withResolvedValue((value) => createValueMatchers(value, negated).toBeNaN())
    },
    async toHaveLength(expected) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toHaveLength(expected))
    },
    async toHaveProperty(path, expected) {
      await withResolvedValue((value) => {
        if (arguments.length > 1) createValueMatchers(value, negated).toHaveProperty(path, expected)
        else createValueMatchers(value, negated).toHaveProperty(path)
      })
    },
    async toBeTypeOf(expected) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toBeTypeOf(expected))
    },
    async toBeInstanceOf(expected) {
      await withResolvedValue((value) => createValueMatchers(value, negated).toBeInstanceOf(expected))
    },
    async toThrow(expected) {
      if (mode === 'rejects') {
        const error = await settleAsyncExpectation(actual, mode)
        const passed = expected === undefined || thrownMatches(error, expected)
        const expectedText = expected === undefined ? '' : ` matching ${formatThrowExpectation(expected)}`
        if (negated ? passed : !passed) {
          const notText = negated ? ' not' : ''
          throw new Error(`Expected promise${notText} to reject${expectedText}.`)
        }
        return
      }
      await withResolvedValue((value) => createValueMatchers(value, negated).toThrow(expected))
    },
    async toSatisfy(predicate, message) {
      const value = (await settleAsyncExpectation(actual, mode)) as TValue
      const actualText = stringifyForAssertion(toJsonValue(value))
      const passed = await predicate(value)
      if (negated ? passed : !passed) {
        throw new Error(message ?? `Expected ${actualText}${negated ? ' not' : ''} to satisfy predicate.`)
      }
    },
  }
  return Object.freeze({
    ...matchers,
    get not() {
      return createAsyncValueMatchers<TValue>(actual, mode, !negated)
    },
  })
}

class PromiseExpectationError extends Error {}

async function settleAsyncExpectation(actual: unknown, mode: AsyncExpectationMode): Promise<unknown> {
  if (!isThenable(actual)) {
    throw new Error(`Expected value for .${mode} to be a promise, got ${stringifyForAssertion(toJsonValue(actual))}.`)
  }
  if (mode === 'resolves') {
    try {
      return await actual
    } catch (error) {
      throw new Error(`Expected promise to resolve, but it rejected with ${errorToMessage(error)}.`)
    }
  }
  try {
    const value = await actual
    throw new PromiseExpectationError(
      `Expected promise to reject, but it resolved with ${stringifyForAssertion(toJsonValue(value))}.`,
    )
  } catch (error) {
    if (error instanceof PromiseExpectationError) throw error
    return error
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && (typeof value === 'object' || typeof value === 'function') && 'then' in value)
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Expected ${label} to be an object, got ${stringifyForAssertion(toJsonValue(value))}.`)
  }
}

function objectContains(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!(key in actual)) return false
    const actualValue = actual[key]
    if (isRecord(actualValue) && isRecord(expectedValue)) {
      if (!objectContains(actualValue, expectedValue)) return false
      continue
    }
    if (Array.isArray(actualValue) && Array.isArray(expectedValue)) {
      if (!arrayContains(actualValue, expectedValue)) return false
      continue
    }
    if (stableJson(toJsonValue(actualValue)) !== stableJson(toJsonValue(expectedValue))) return false
  }
  return true
}

function arrayContains(actual: readonly unknown[], expected: readonly unknown[]): boolean {
  if (actual.length < expected.length) return false
  for (let index = 0; index < expected.length; index += 1) {
    const actualValue = actual[index]
    const expectedValue = expected[index]
    if (isRecord(actualValue) && isRecord(expectedValue)) {
      if (!objectContains(actualValue, expectedValue)) return false
      continue
    }
    if (stableJson(toJsonValue(actualValue)) !== stableJson(toJsonValue(expectedValue))) return false
  }
  return true
}

function valueLength(value: unknown): number | undefined {
  if (typeof value === 'string' || Array.isArray(value)) return value.length
  if (value && typeof value === 'object' && 'length' in value) {
    const length = (value as { readonly length?: unknown }).length
    if (typeof length === 'number') return length
  }
  return undefined
}

function lengthText(length: number | undefined): string {
  return length === undefined ? 'undefined' : String(length)
}

function propertyPath(path: string | readonly PropertyKey[]): readonly PropertyKey[] {
  if (typeof path !== 'string') return Object.freeze([...path])
  if (!path) return Object.freeze([])
  return Object.freeze(path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)))
}

function getPropertyPath(
  value: unknown,
  path: readonly PropertyKey[],
): { readonly exists: boolean; readonly value?: unknown } {
  let current = value
  for (const part of path) {
    if (!current || (typeof current !== 'object' && typeof current !== 'function')) return { exists: false }
    if (!(part in current)) return { exists: false }
    current = (current as Record<PropertyKey, unknown>)[part]
  }
  return { exists: true, value: current }
}

function formatPropertyPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '<root>'
  return path.map((part) => String(part)).join('.')
}

function captureThrown(
  fn: () => unknown,
): { readonly threw: true; readonly error: unknown } | { readonly threw: false } {
  try {
    fn()
    return { threw: false }
  } catch (error) {
    return { threw: true, error }
  }
}

function thrownMatches(error: unknown, expected: QualityThrowExpectation): boolean {
  if (typeof expected === 'string') return errorToMessage(error).includes(expected)
  if (expected instanceof RegExp) return expected.test(errorToMessage(error))
  return error instanceof expected
}

function formatThrowExpectation(expected: QualityThrowExpectation): string {
  if (typeof expected === 'string') return JSON.stringify(expected)
  if (expected instanceof RegExp) return expected.toString()
  return expected.name || 'provided error class'
}

type NumericComparable = number | bigint

function checkNumericComparison(
  actual: unknown,
  expected: NumericComparable,
  operator: '>' | '>=' | '<' | '<=',
  compare: (actualValue: NumericComparable, expectedValue: NumericComparable) => boolean,
  negated: boolean,
): void {
  assertNumericComparable(actual, 'actual value')
  assertNumericComparable(expected, 'expected value')
  const passed = compare(actual, expected)
  if (negated ? passed : !passed) {
    const notText = negated ? ' not' : ''
    throw new Error(
      `Expected ${formatNumericComparable(actual)}${notText} to be ${operator} ${formatNumericComparable(expected)}.`,
    )
  }
}

function assertNumericComparable(value: unknown, label: string): asserts value is NumericComparable {
  if (typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`Expected ${label} to be a number or bigint, got ${stringifyForAssertion(toJsonValue(value))}.`)
  }
  if (typeof value === 'number' && Number.isNaN(value)) {
    throw new Error(`Expected ${label} to be a number or bigint, got NaN.`)
  }
}

function formatNumericComparable(value: NumericComparable): string {
  return typeof value === 'bigint' ? `${value.toString()}n` : String(value)
}

const expectFn = (<const TValue>(actual: TValue): QualityValueMatchers<TValue> =>
  createValueMatchers(actual)) as QualityExpectApi

expectFn.all =
  <TInput extends Record<string, unknown>, TOutput>(
    ...expectations: readonly QualityExpectation<TInput, TOutput>[]
  ): QualityExpectation<TInput, TOutput> =>
  async (result: QualityExpectationContext<TInput, TOutput>) => {
    for (const expectation of expectations) await expectation(result)
  }

expectFn.retrieval = (source): QualityRetrievalMatchers =>
  Object.freeze({
    toContainHit(expected: ExpectedRetrievalHit) {
      const hits = extractRetrievalHits(expectSourceValue(source))
      if (!hits.some((hit) => retrievalHitMatches(hit, expected))) {
        throw new Error(`Expected retrieval hit ${stableJson(toJsonValue(expected))}.`)
      }
    },
    toHaveHitCount(count: number) {
      const hits = extractRetrievalHits(expectSourceValue(source))
      if (hits.length !== count) throw new Error(`Expected ${count} retrieval hits, got ${hits.length}.`)
    },
    toHaveMinHitCount(count: number) {
      const hits = extractRetrievalHits(expectSourceValue(source))
      if (hits.length < count) throw new Error(`Expected at least ${count} retrieval hits, got ${hits.length}.`)
    },
    toHaveMaxHitCount(count: number) {
      const hits = extractRetrievalHits(expectSourceValue(source))
      if (hits.length > count) throw new Error(`Expected at most ${count} retrieval hits, got ${hits.length}.`)
    },
    toHaveTopHit(expected: ExpectedRetrievalHit) {
      const hits = extractRetrievalHits(expectSourceValue(source))
      const topHit = hits[0]
      if (!topHit) throw new Error('Expected retrieval top hit, got no retrieval hits.')
      if (!retrievalHitMatches(topHit, expected)) {
        throw new Error(`Expected retrieval top hit ${stableJson(toJsonValue(expected))}.`)
      }
    },
  })

expectFn.output = (source): QualityOutputMatchers =>
  Object.freeze({
    toMatchSchema(schema: QualitySchema) {
      const output = expectSourceValue(source)
      const result = schema.safeParse(output)
      if (!result.success) {
        throw new Error(`Expected output to match schema: ${schemaErrorMessage(result.error)}.`)
      }
    },
    toHaveField(path: string | readonly PropertyKey[], expected?: unknown) {
      const output = expectSourceValue(source)
      const actualPath = propertyPath(path)
      const resolved = getPropertyPath(output, actualPath)
      const pathText = formatPropertyPath(actualPath)
      const hasExpected = arguments.length > 1
      if (!resolved.exists) throw new Error(`Expected output to have field ${pathText}.`)
      if (hasExpected && stableJson(toJsonValue(resolved.value)) !== stableJson(toJsonValue(expected))) {
        throw new Error(`Expected output field ${pathText} to equal ${stringifyForAssertion(toJsonValue(expected))}.`)
      }
    },
    toHaveNoField(path: string | readonly PropertyKey[]) {
      const output = expectSourceValue(source)
      const actualPath = propertyPath(path)
      const resolved = getPropertyPath(output, actualPath)
      if (resolved.exists) throw new Error(`Expected output not to have field ${formatPropertyPath(actualPath)}.`)
    },
  })

expectFn.toolCalls = (source): QualityToolCallMatchers =>
  Object.freeze({
    toHaveCalled(name: string, expected?: ExpectedToolCall) {
      const calls = extractToolCalls(expectSourceValue(source))
      const matching = calls.filter((call) => toolCallName(call) === name)
      if (matching.length === 0) throw new Error(`Expected tool "${name}" to be called.`)
      const expectedArgs = expected?.args
      if ('args' in (expected ?? {}) && !matching.some((call) => deepJsonEqual(toolCallArgs(call), expectedArgs))) {
        throw new Error(
          `Expected tool "${name}" to be called with args ${stringifyForAssertion(toJsonValue(expectedArgs))}.`,
        )
      }
      if (
        'result' in (expected ?? {}) &&
        !matching.some((call) => deepJsonEqual(toolCallResult(call), expected?.result))
      ) {
        throw new Error(`Expected tool "${name}" to return ${stringifyForAssertion(toJsonValue(expected?.result))}.`)
      }
    },
    toHaveCalledTimes(name: string, count: number) {
      const calls = extractToolCalls(expectSourceValue(source))
      const actual = calls.filter((call) => toolCallName(call) === name).length
      if (actual !== count) throw new Error(`Expected tool "${name}" to be called ${count} time(s), got ${actual}.`)
    },
    toHaveCalledWith(name: string, args: unknown) {
      const calls = extractToolCalls(expectSourceValue(source)).filter((call) => toolCallName(call) === name)
      if (!calls.some((call) => deepJsonEqual(toolCallArgs(call), args))) {
        throw new Error(`Expected tool "${name}" to be called with args ${stringifyForAssertion(toJsonValue(args))}.`)
      }
    },
    toHaveReturned(name: string) {
      const calls = extractToolCalls(expectSourceValue(source)).filter((call) => toolCallName(call) === name)
      if (!calls.some((call) => toolCallResult(call) !== undefined)) {
        throw new Error(`Expected tool "${name}" to return a result.`)
      }
    },
    toHaveReturnedWith(name: string, result: unknown) {
      const calls = extractToolCalls(expectSourceValue(source)).filter((call) => toolCallName(call) === name)
      if (!calls.some((call) => deepJsonEqual(toolCallResult(call), result))) {
        throw new Error(`Expected tool "${name}" to return ${stringifyForAssertion(toJsonValue(result))}.`)
      }
    },
    toHaveFailed(name: string) {
      const calls = extractToolCalls(expectSourceValue(source)).filter((call) => toolCallName(call) === name)
      if (!calls.some(toolCallFailed)) throw new Error(`Expected tool "${name}" to fail.`)
    },
    toHaveCallSequence(names: readonly string[]) {
      const actualNames = extractToolCalls(expectSourceValue(source)).map(toolCallName).filter(isString)
      if (!containsSubsequence(actualNames, names)) {
        throw new Error(
          `Expected tool call sequence ${stableJson(toJsonValue(names))}, got ${stableJson(toJsonValue(actualNames))}.`,
        )
      }
    },
    toHaveNoUnexpectedCalls(allowedNames: readonly string[]) {
      const allowed = new Set(allowedNames)
      const unexpected = extractToolCalls(expectSourceValue(source))
        .map(toolCallName)
        .filter(isString)
        .filter((name) => !allowed.has(name))
      if (unexpected.length > 0) {
        throw new Error(`Expected no unexpected tool calls, got ${stableJson(toJsonValue(unexpected))}.`)
      }
    },
  })

expectFn.steps = (source): QualityStepMatchers =>
  Object.freeze({
    toHaveSucceeded(id: string) {
      const step = extractFlowSteps(expectSourceValue(source)).find((item) => flowStepId(item) === id)
      if (!step) throw new Error(`Expected flow step "${id}" to exist.`)
      const status = flowStepStatus(step)
      if (status && !['completed', 'success', 'succeeded', 'passed'].includes(status)) {
        throw new Error(`Expected flow step "${id}" to succeed, got "${status}".`)
      }
    },
    toHaveStatus(id: string, expectedStatus: string) {
      const step = extractFlowSteps(expectSourceValue(source)).find((item) => flowStepId(item) === id)
      if (!step) throw new Error(`Expected flow step "${id}" to exist.`)
      const status = flowStepStatus(step)
      if (status !== expectedStatus)
        throw new Error(`Expected flow step "${id}" to have status "${expectedStatus}", got "${status ?? 'unknown'}".`)
    },
    toHaveRun(id: string) {
      const step = extractFlowSteps(expectSourceValue(source)).find((item) => flowStepId(item) === id)
      if (!step) throw new Error(`Expected flow step "${id}" to run.`)
    },
    toHaveFailed(id: string) {
      const step = extractFlowSteps(expectSourceValue(source)).find((item) => flowStepId(item) === id)
      if (!step) throw new Error(`Expected flow step "${id}" to exist.`)
      const status = flowStepStatus(step)
      const failed = Boolean(
        step.error !== undefined ||
        (typeof status === 'string' && ['error', 'failed', 'failure'].includes(status.toLowerCase())),
      )
      if (!failed) throw new Error(`Expected flow step "${id}" to fail, got "${status ?? 'unknown'}".`)
    },
    toHaveStepOrder(ids: readonly string[]) {
      const actualIds = extractFlowSteps(expectSourceValue(source)).map(flowStepId).filter(isString)
      if (!containsSubsequence(actualIds, ids)) {
        throw new Error(
          `Expected flow step order ${stableJson(toJsonValue(ids))}, got ${stableJson(toJsonValue(actualIds))}.`,
        )
      }
    },
    toHaveOutput(id: string, expectedPartial: unknown) {
      const step = extractFlowSteps(expectSourceValue(source)).find((item) => flowStepId(item) === id)
      if (!step) throw new Error(`Expected flow step "${id}" to exist.`)
      const output = step.output ?? step.result
      const matches =
        isRecord(output) && isRecord(expectedPartial)
          ? objectContains(output, expectedPartial)
          : deepJsonEqual(output, expectedPartial)
      if (!matches) {
        throw new Error(
          `Expected flow step "${id}" output to match ${stringifyForAssertion(toJsonValue(expectedPartial))}.`,
        )
      }
    },
    toHaveToolCall(id: string, toolName: string) {
      const step = extractFlowSteps(expectSourceValue(source)).find((item) => flowStepId(item) === id)
      if (!step) throw new Error(`Expected flow step "${id}" to exist.`)
      if (!extractToolCalls(step).some((call) => toolCallName(call) === toolName)) {
        throw new Error(`Expected flow step "${id}" to call tool "${toolName}".`)
      }
    },
  })

expectFn.citations = (source): QualityCitationMatchers =>
  Object.freeze({
    toContainCitation(expected: ExpectedCitation) {
      const citations = extractCitations(expectSourceValue(source))
      if (!citations.some((citation) => citationMatches(citation, expected))) {
        throw new Error(`Expected citation ${stableJson(toJsonValue(expected))}.`)
      }
    },
    toHaveCitationCount(count: number) {
      const citations = extractCitations(expectSourceValue(source))
      if (citations.length !== count) throw new Error(`Expected ${count} citations, got ${citations.length}.`)
    },
    toHaveCitationForSource(sourceId: string) {
      const citations = extractCitations(expectSourceValue(source))
      if (!citations.some((citation) => citation.sourceId === sourceId)) {
        throw new Error(`Expected citation for source "${sourceId}".`)
      }
    },
    toHaveAllCitationsResolved() {
      const citations = extractCitations(expectSourceValue(source))
      if (citations.length === 0) throw new Error('Expected at least one resolved citation, got none.')
      const unresolved = citations.filter((citation) => !citation.sourceId.trim())
      if (unresolved.length > 0)
        throw new Error(`Expected all citations to be resolved, got ${unresolved.length} unresolved.`)
    },
    toHaveNoDanglingCitations() {
      const citations = extractCitations(expectSourceValue(source))
      const dangling = citations.filter((citation) => !citation.sourceId.trim())
      if (dangling.length > 0) throw new Error(`Expected no dangling citations, got ${dangling.length}.`)
    },
    toHaveMinimumQuoteLength(length: number) {
      const citations = extractCitations(expectSourceValue(source))
      const short = citations.filter((citation) => (citation.quote?.length ?? 0) < length)
      if (short.length > 0) throw new Error(`Expected all citation quotes to be at least ${length} characters.`)
    },
    toQuoteOutput() {
      const output = expectSourceValue(source)
      const text = extractCitationQuoteText(output)
      const citations = extractCitations(output).filter((citation) => citation.quote)
      if (citations.length === 0) throw new Error('Expected at least one citation quote.')
      const missing = citations.filter((citation) => citation.quote && !text.includes(citation.quote))
      if (missing.length > 0)
        throw new Error(`Expected citation quotes to appear in output, got ${missing.length} missing quote(s).`)
    },
  })

expectFn.usage = (source): QualityUsageMatchers =>
  Object.freeze({
    toHaveTokenUsageBelow(tokens: number) {
      const usage = extractUsageRecord(source)
      const totalTokens = usageTotalTokens(usage)
      if (totalTokens === undefined) throw new Error('Expected token usage to be present.')
      if (totalTokens >= tokens) throw new Error(`Expected token usage below ${tokens}, got ${totalTokens}.`)
    },
    toHaveCostBelow(cost: number) {
      const actualCost = extractCostValue(source)
      if (actualCost === undefined) throw new Error('Expected cost to be present.')
      if (actualCost >= cost) throw new Error(`Expected cost below ${cost}, got ${actualCost}.`)
    },
    toHaveModel(model: string) {
      const actualModel = extractModelValue(source)
      if (actualModel !== model) throw new Error(`Expected model "${model}", got "${actualModel ?? 'unknown'}".`)
    },
    toHaveNoFallback() {
      if (extractFallbackUsed(source)) throw new Error('Expected no fallback model to be used.')
    },
    toHaveUsedFallback() {
      if (!extractFallbackUsed(source)) throw new Error('Expected fallback model to be used.')
    },
  })

expectFn.handoffs = (source): QualityHandoffMatchers =>
  Object.freeze({
    toHaveHandoff(expected: ExpectedHandoff) {
      const handoffs = extractHandoffs(expectSourceValue(source))
      if (!handoffs.some((handoff) => handoffMatches(handoff, expected))) {
        throw new Error(`Expected handoff ${stableJson(toJsonValue(expected))}.`)
      }
    },
    toHaveHandoffPath(path: readonly string[]) {
      const actualPath = extractHandoffPath(expectSourceValue(source))
      if (stableJson(toJsonValue(actualPath)) !== stableJson(toJsonValue(path))) {
        throw new Error(
          `Expected handoff path ${stableJson(toJsonValue(path))}, got ${stableJson(toJsonValue(actualPath))}.`,
        )
      }
    },
    toHaveHandoffCount(count: number) {
      const value = expectSourceValue(source)
      const path = extractHandoffPath(value)
      const actual = path.length > 1 ? path.length - 1 : extractHandoffs(value).length
      if (actual !== count) throw new Error(`Expected ${count} handoff(s), got ${actual}.`)
    },
  })

expectFn.artifacts = (source): QualityArtifactMatchers =>
  Object.freeze({
    toHaveArtifact(expected: ExpectedArtifact) {
      const artifacts = extractArtifacts(expectSourceValue(source))
      if (!artifacts.some((artifact) => artifactMatches(artifact, expected))) {
        throw new Error(`Expected artifact ${stableJson(toJsonValue(expected))}.`)
      }
    },
    toHaveArtifactKind(kind: string) {
      const artifacts = extractArtifacts(expectSourceValue(source))
      if (!artifacts.some((artifact) => artifact.kind === kind)) throw new Error(`Expected artifact kind "${kind}".`)
    },
    toHaveArtifactPath(path: string) {
      const artifacts = extractArtifacts(expectSourceValue(source))
      if (!artifacts.some((artifact) => artifact.path === path)) {
        throw new Error(`Expected artifact at path "${path}".`)
      }
    },
    toHaveArtifactCount(count: number) {
      const artifacts = extractArtifacts(expectSourceValue(source))
      if (artifacts.length !== count) throw new Error(`Expected ${count} artifact(s), got ${artifacts.length}.`)
    },
    toHaveArtifactContent(pathOrName: string, expected: string | RegExp | unknown) {
      const artifact = extractArtifacts(expectSourceValue(source)).find(
        (item) => item.path === pathOrName || item.name === pathOrName || item.id === pathOrName,
      )
      if (!artifact) throw new Error(`Expected artifact "${pathOrName}" to exist.`)
      const content = artifact.content ?? artifact.preview
      if (typeof expected === 'string') {
        const text = stringifyForAssertion(toJsonValue(content))
        if (!text.includes(expected)) throw new Error(`Expected artifact "${pathOrName}" to contain "${expected}".`)
        return
      }
      if (expected instanceof RegExp) {
        const text = stringifyForAssertion(toJsonValue(content))
        if (!expected.test(text)) throw new Error(`Expected artifact "${pathOrName}" to match ${expected.toString()}.`)
        return
      }
      if (!deepJsonEqual(content, expected)) {
        throw new Error(
          `Expected artifact "${pathOrName}" content to equal ${stringifyForAssertion(toJsonValue(expected))}.`,
        )
      }
    },
  })

expectFn.safety = (source): QualitySafetyMatchers =>
  Object.freeze({
    toHaveGuardrailAction(name: string, action: string) {
      const guardrails = extractGuardrails(expectSourceValue(source))
      if (!guardrails.some((entry) => entry.name === name && entry.action === action)) {
        throw new Error(`Expected guardrail "${name}" to have action "${action}".`)
      }
    },
    toHaveBlockedGuardrail(name?: string) {
      const guardrails = extractGuardrails(expectSourceValue(source))
      const blocked = guardrails.filter((entry) => entry.action === 'block')
      const matched = name ? blocked.some((entry) => entry.name === name) : blocked.length > 0
      if (!matched) {
        throw new Error(name ? `Expected guardrail "${name}" to block.` : 'Expected a guardrail to block.')
      }
    },
    toHaveNoBlockedGuardrails() {
      const blocked = extractGuardrails(expectSourceValue(source)).filter((entry) => entry.action === 'block')
      if (blocked.length > 0) throw new Error(`Expected no blocked guardrails, got ${blocked.length}.`)
    },
    toHaveConstraintPassed(name: string) {
      const constraint = extractConstraints(expectSourceValue(source)).find((entry) => entry.name === name)
      if (!constraint) throw new Error(`Expected constraint "${name}" to be checked.`)
      if (constraint.pass !== true) throw new Error(`Expected constraint "${name}" to pass.`)
    },
    toHaveConstraintFailed(name: string) {
      const constraint = extractConstraints(expectSourceValue(source)).find((entry) => entry.name === name)
      if (!constraint) throw new Error(`Expected constraint "${name}" to be checked.`)
      if (constraint.pass !== false) throw new Error(`Expected constraint "${name}" to fail.`)
    },
    toHaveAllConstraintsPassed() {
      const constraints = extractConstraints(expectSourceValue(source))
      if (constraints.length === 0) throw new Error('Expected at least one constraint check, got none.')
      const failed = constraints.filter((entry) => entry.pass === false)
      if (failed.length > 0) throw new Error(`Expected all constraints to pass, got ${failed.length} failed.`)
    },
    toHaveConstraintRetry(name?: string) {
      const constraints = extractConstraints(expectSourceValue(source))
      const retried = constraints.filter((entry) => (entry.attempts ?? 1) > 1)
      const matched = name ? retried.some((entry) => entry.name === name) : retried.length > 0
      if (!matched) {
        throw new Error(name ? `Expected constraint "${name}" to retry.` : 'Expected a constraint retry.')
      }
    },
  })

expectFn.memory = (source): QualityMemoryMatchers =>
  Object.freeze({
    toHaveMemoryOperation(expected: ExpectedMemoryOperation) {
      const operations = extractMemoryOperations(expectSourceValue(source))
      if (!operations.some((operation) => memoryOperationMatches(operation, expected))) {
        throw new Error(`Expected memory operation ${stableJson(toJsonValue(expected))}.`)
      }
    },
    toHaveRead(expected: Omit<ExpectedMemoryOperation, 'operation'> = {}) {
      const operations = extractMemoryOperations(expectSourceValue(source))
      if (!operations.some((operation) => memoryOperationMatches(operation, { ...expected, operation: 'read' }))) {
        throw new Error(`Expected memory read ${stableJson(toJsonValue(expected))}.`)
      }
    },
    toHaveWritten(expected: Omit<ExpectedMemoryOperation, 'operation'> = {}) {
      const operations = extractMemoryOperations(expectSourceValue(source))
      if (!operations.some((operation) => memoryOperationMatches(operation, { ...expected, operation: 'write' }))) {
        throw new Error(`Expected memory write ${stableJson(toJsonValue(expected))}.`)
      }
    },
    toHaveMemoryValue(keyOrBlockId: string, expected: unknown) {
      const operations = extractMemoryOperations(expectSourceValue(source))
      const matching = operations.filter(
        (operation) => operation.key === keyOrBlockId || operation.blockId === keyOrBlockId,
      )
      if (!matching.some((operation) => deepJsonEqual(operation.value, expected))) {
        throw new Error(
          `Expected memory value for "${keyOrBlockId}" to equal ${stringifyForAssertion(toJsonValue(expected))}.`,
        )
      }
    },
  })

expectFn.workspace = (source): QualityWorkspaceMatchers =>
  Object.freeze({
    toHaveWorkspaceOperation(expected: ExpectedWorkspaceOperation) {
      const operations = extractWorkspaceOperations(expectSourceValue(source))
      if (!operations.some((operation) => workspaceOperationMatches(operation, expected))) {
        throw new Error(`Expected workspace operation ${stableJson(toJsonValue(expected))}.`)
      }
    },
    toHaveRead(path: string) {
      const operations = extractWorkspaceOperations(expectSourceValue(source))
      if (!operations.some((operation) => workspaceOperationMatches(operation, { operation: 'read', path }))) {
        throw new Error(`Expected workspace read at "${path}".`)
      }
    },
    toHaveWritten(path: string) {
      const operations = extractWorkspaceOperations(expectSourceValue(source))
      if (!operations.some((operation) => workspaceOperationMatches(operation, { operation: 'write', path }))) {
        throw new Error(`Expected workspace write at "${path}".`)
      }
    },
    toHaveDeleted(path: string) {
      const operations = extractWorkspaceOperations(expectSourceValue(source))
      if (!operations.some((operation) => workspaceOperationMatches(operation, { operation: 'delete', path }))) {
        throw new Error(`Expected workspace delete at "${path}".`)
      }
    },
    toHaveListed(path?: string) {
      const operations = extractWorkspaceOperations(expectSourceValue(source))
      const expected = path ? { operation: 'list', path } : { operation: 'list' }
      if (!operations.some((operation) => workspaceOperationMatches(operation, expected))) {
        throw new Error(path ? `Expected workspace list at "${path}".` : 'Expected workspace list operation.')
      }
    },
    toHaveNoWritesOutside(allowedPaths: readonly string[]) {
      const allowed = new Set(allowedPaths)
      const unexpected = extractWorkspaceOperations(expectSourceValue(source)).filter(
        (operation) => operation.operation === 'write' && operation.path && !allowed.has(operation.path),
      )
      if (unexpected.length > 0) {
        throw new Error(
          `Expected no workspace writes outside allowed paths, got ${stableJson(toJsonValue(unexpected.map((item) => item.path)))}.`,
        )
      }
    },
  })

expectFn.routing = (source): QualityRoutingMatchers =>
  Object.freeze({
    toHaveRoutingKind(kind: string) {
      const reports = extractRoutingReports(expectSourceValue(source))
      if (!reports.some((report) => report.routingKind === kind)) throw new Error(`Expected routing kind "${kind}".`)
    },
    toHaveSelectedRoute(route: string) {
      const reports = extractRoutingReports(expectSourceValue(source))
      if (!reports.some((report) => report.chosen === route)) throw new Error(`Expected selected route "${route}".`)
    },
    toHaveClassifiedAs(label: string) {
      const reports = extractRoutingReports(expectSourceValue(source))
      if (!reports.some((report) => report.classifiedAs === label)) {
        throw new Error(`Expected routing classification "${label}".`)
      }
    },
    toHaveSelectedModel(model: string) {
      const reports = extractRoutingReports(expectSourceValue(source))
      if (
        !reports.some(
          (report) =>
            report.selectedModel === model ||
            report.tiers.some((tier) => tier.model === model && tier.verdict === 'accepted'),
        )
      ) {
        throw new Error(`Expected selected routing model "${model}".`)
      }
    },
    toHaveFallbackReason(reason: string | RegExp) {
      const reports = extractRoutingReports(expectSourceValue(source))
      const matches = reports.some((report) => {
        if (!report.fallbackReason) return false
        return typeof reason === 'string' ? report.fallbackReason.includes(reason) : reason.test(report.fallbackReason)
      })
      if (!matches)
        throw new Error(
          `Expected routing fallback reason ${typeof reason === 'string' ? JSON.stringify(reason) : reason.toString()}.`,
        )
    },
    toHaveTierVerdict(model: string, verdict: string) {
      const reports = extractRoutingReports(expectSourceValue(source))
      if (!reports.some((report) => report.tiers.some((tier) => tier.model === model && tier.verdict === verdict))) {
        throw new Error(`Expected routing tier for model "${model}" to have verdict "${verdict}".`)
      }
    },
  })

export const expect: QualityExpectApi = Object.freeze(expectFn)

function expectSourceValue(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): unknown {
  return isRecord(source) && 'output' in source ? source.output : source
}

export const cassette = Object.assign(createCassette, {
  record: (path: string, options: Omit<CassetteConfig, 'path' | 'mode'> = {}) =>
    createCassette({ ...options, path, mode: 'record' }),
  replay: (path: string, options: Omit<CassetteConfig, 'path' | 'mode'> = {}) =>
    createCassette({ ...options, path, mode: 'replay' }),
  auto: (path: string, options: Omit<CassetteConfig, 'path' | 'mode'> = {}) =>
    createCassette({ ...options, path, mode: 'auto' }),
  update: (path: string, options: Omit<CassetteConfig, 'path' | 'mode'> = {}) =>
    createCassette({ ...options, path, mode: 'update' }),
  ci: (path: string, options: Omit<CassetteConfig, 'path' | 'mode'> = {}) =>
    createCassette({ ...options, path, mode: 'ci' }),
  off: (path = '') => createCassette({ path, mode: 'off' }),
  middleware: createCassetteMiddleware,
})

function createCassetteMiddleware(input: Cassette, options: CassetteMiddlewareOptions = {}): PromptMiddleware {
  return async (args, next) => {
    const request = createMiddlewareCassetteRequest(args, options)
    return input.run(request, async () => next(args)) as Promise<MiddlewareResult>
  }
}

function createMiddlewareCassetteRequest(
  args: PromptMiddlewareArgs,
  options: CassetteMiddlewareOptions,
): CassetteRequest {
  const operation = args.operation === 'stream' ? 'stream' : 'generate'
  return {
    kind: operation,
    targetId: resolveCassetteOption(options.targetId, args) ?? args.promptId,
    caseId: resolveCassetteOption(options.caseId, args),
    provider: args.provider,
    model: stringifyModel(args.model),
    inputHash: hashJson(toJsonValue(args.input ?? {})),
    promptHash: hashJson(
      toJsonValue({
        system: args.resolved?.system,
        prompt: args.resolved?.prompt,
        messages: args.resolved?.messages,
        outputMode: args.outputMode,
      }),
    ),
    settingsHash: hashJson(toJsonValue(stripCassettePreparedArgs(args.preparedArgs))),
    ...(args.preparedArgs.tools ? { toolSchemaHash: hashJson(toJsonValue(args.preparedArgs.tools)) } : {}),
  }
}

function resolveCassetteOption(
  option: CassetteMiddlewareOptions['targetId'] | CassetteMiddlewareOptions['caseId'],
  args: PromptMiddlewareArgs,
): string | undefined {
  return typeof option === 'function' ? option(args) : option
}

function stringifyModel(model: unknown): string | undefined {
  if (typeof model === 'string') return model
  if (!model || typeof model !== 'object') return undefined
  const record = model as Record<string, unknown>
  for (const key of ['modelId', 'id', 'model', 'name']) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  const provider = typeof record.provider === 'string' ? record.provider : undefined
  return provider
}

function stripCassettePreparedArgs(preparedArgs: Record<string, unknown>): Record<string, unknown> {
  const stripped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(preparedArgs)) {
    if (key === 'model') continue
    stripped[key] = value
  }
  return stripped
}

export function quality(config: QualityConfig): Quality {
  if (!config.id.trim()) throw new Error('quality(): id must be non-empty.')
  const dir = config.dir ?? '.crux/quality'

  async function evaluate<TInput extends Record<string, unknown>, TOutput>(
    options: QualityEvaluateOptions<TInput, TOutput>,
  ): Promise<ExperimentRecord> {
    const experimentId = options.id ?? `experiment-${Date.now()}`
    const variants = normalizeVariants(options)
    const span = observe.openSpan({
      name: 'quality.evaluate',
      family: 'eval',
      primitive: 'eval.run',
      attributes: {
        qualityId: config.id,
        experimentId,
        suiteId: options.suite.id,
        caseCount: options.suite.cases.length,
        variantCount: Object.keys(variants).length,
        scorerCount: options.scorers?.length ?? 0,
        hasReplay: options.replay !== undefined,
        baselineVariantId: options.baseline,
      },
    })
    try {
      const experiment = await span.withContext(async () => {
        const result = await runExperiment(config.id, options, experimentId, variants)
        await writeExperiment(dir, result)
        return result
      })
      span.end({
        qualityId: config.id,
        experimentId: experiment.id,
        suiteId: experiment.suite.id,
        status: experiment.status,
        total: experiment.summary.total,
        passed: experiment.summary.passed,
        failed: experiment.summary.failed,
        errored: experiment.summary.errored,
        variantCount: experiment.variants.length,
      })
      return experiment
    } catch (error) {
      span.error(error, {
        qualityId: config.id,
        experimentId,
        suiteId: options.suite.id,
      })
      throw error
    }
  }

  async function getExperiment(id: string): Promise<ExperimentRecord | null> {
    try {
      const raw = await readFile(join(dir, 'experiments', `${safeFileName(id)}.json`), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      return isExperimentRecord(parsed) ? parsed : null
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) return null
      throw error
    }
  }

  async function listExperiments(): Promise<readonly ExperimentRecord[]> {
    const experimentsDir = join(dir, 'experiments')
    let files: string[]
    try {
      files = await readdir(experimentsDir)
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) return Object.freeze([])
      throw error
    }

    const records: ExperimentRecord[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const raw = await readFile(join(experimentsDir, file), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (isExperimentRecord(parsed)) records.push(parsed)
    }
    records.sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    return Object.freeze(records)
  }

  async function compare(options: QualityCompareOptions): Promise<QualityComparisonRecord> {
    const baselineSide = await resolveComparisonSide(options.baseline, getExperiment)
    const candidateSide = await resolveComparisonSide(options.candidate, getExperiment)
    const comparedAt = new Date().toISOString()
    const id =
      options.id ??
      `${baselineSide.summary.experimentId}${baselineSide.summary.variantId ? `-${baselineSide.summary.variantId}` : ''}-vs-${candidateSide.summary.experimentId}${candidateSide.summary.variantId ? `-${candidateSide.summary.variantId}` : ''}`
    const metrics = compareSummaries(baselineSide.summary, candidateSide.summary)
    const gates = options.gates ? evaluateComparisonGates(metrics, candidateSide.summary, options.gates) : undefined
    const record: QualityComparisonRecord = Object.freeze({
      _tag: 'QualityComparison' as const,
      id,
      qualityId: config.id,
      comparedAt,
      baseline: baselineSide.summary,
      candidate: candidateSide.summary,
      metrics,
      ...(gates ? { gates } : {}),
      status: comparisonStatus(metrics),
    })
    await writeComparison(dir, record)
    return record
  }

  async function getComparison(id: string): Promise<QualityComparisonRecord | null> {
    return readTaggedRecord(join(dir, 'comparisons', `${safeFileName(id)}.json`), isQualityComparisonRecord)
  }

  async function listComparisons(): Promise<readonly QualityComparisonRecord[]> {
    const records = await listTaggedRecords(join(dir, 'comparisons'), isQualityComparisonRecord)
    records.sort((left, right) => Date.parse(right.comparedAt) - Date.parse(left.comparedAt))
    return Object.freeze(records)
  }

  async function promote(options: QualityPromoteOptions): Promise<QualityBaselineRecord> {
    if (!options.id.trim()) throw new Error('quality.promote(): id must be non-empty.')
    const experiment = await resolveExperiment(options.experiment, getExperiment)
    const summary = summarizeExperimentForComparison(experiment, options.variantId, options.label)
    const record: QualityBaselineRecord = Object.freeze({
      _tag: 'QualityBaseline' as const,
      id: options.id,
      qualityId: config.id,
      experimentId: experiment.id,
      ...(options.variantId ? { variantId: options.variantId } : {}),
      ...(options.label ? { label: options.label } : {}),
      promotedAt: new Date().toISOString(),
      summary,
    })
    await writeBaseline(dir, record)
    return record
  }

  async function getBaseline(id: string): Promise<QualityBaselineRecord | null> {
    return readTaggedRecord(join(dir, 'baselines', `${safeFileName(id)}.json`), isQualityBaselineRecord)
  }

  async function listBaselines(): Promise<readonly QualityBaselineRecord[]> {
    const records = await listTaggedRecords(join(dir, 'baselines'), isQualityBaselineRecord)
    records.sort((left, right) => Date.parse(right.promotedAt) - Date.parse(left.promotedAt))
    return Object.freeze(records)
  }

  const feedbackApi: QualityFeedbackApi = Object.freeze({
    record: async (input: QualityFeedbackInput) => {
      const span = observe.openSpan({
        name: 'feedback.record',
        family: 'feedback',
        primitive: 'feedback.record',
        attributes: feedbackInputAttributes(config.id, input),
      })
      try {
        const record = await span.withContext(async () => {
          const created = createFeedbackRecord(config.id, input, config.privacy?.redact ?? [])
          await appendFeedbackRecord(dir, created)
          emitFeedbackArtifact(span.spanId, created)
          return created
        })
        span.end({
          qualityId: config.id,
          feedbackId: record.id,
          status: record.status,
          traceId: record.traceId,
          experimentId: record.experimentId,
          caseId: record.caseId,
        })
        return record
      } catch (error) {
        span.error(error, feedbackInputAttributes(config.id, input))
        throw error
      }
    },
    list: async () => {
      const records = await readFeedbackRecords(dir)
      records.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      return Object.freeze(records)
    },
    annotate: async (input: QualityFeedbackAnnotationInput) => {
      const record = await createFeedbackAnnotationRecord(config.id, dir, input, config.privacy?.redact ?? [])
      await appendFeedbackAnnotationRecord(dir, record)
      return record
    },
    listAnnotations: async (feedbackId?: string) => {
      const records = await readFeedbackAnnotationRecords(dir)
      const filtered = feedbackId ? records.filter((record) => record.feedbackId === feedbackId) : records
      filtered.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      return Object.freeze(filtered)
    },
    proposeMemory: async (input: QualityFeedbackMemoryProposalInput) => {
      const record = await createFeedbackMemoryProposalRecord(config.id, dir, input, config.privacy?.redact ?? [])
      await appendFeedbackMemoryProposalRecord(dir, record)
      return record
    },
    listMemoryProposals: async (feedbackId?: string) => {
      const records = await readFeedbackMemoryProposalRecords(dir)
      const filtered = feedbackId ? records.filter((record) => record.feedbackId === feedbackId) : records
      filtered.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      return Object.freeze(filtered)
    },
    exportSuite: async (options: QualityFeedbackSuiteOptions) => exportFeedbackSuite(dir, options),
    writeSuite: async (options: QualityFeedbackWriteSuiteOptions) => {
      const portable = await exportFeedbackSuite(dir, options)
      await writeFile(options.path, `${JSON.stringify(portable, null, 2)}\n`)
      return portable
    },
  })

  return Object.freeze({
    _tag: 'Quality' as const,
    id: config.id,
    dir,
    evaluate,
    getExperiment,
    listExperiments,
    compare,
    getComparison,
    listComparisons,
    promote,
    getBaseline,
    listBaselines,
    feedback: feedbackApi,
  })
}

async function runExperiment<TInput extends Record<string, unknown>, TOutput>(
  qualityId: string,
  options: QualityEvaluateOptions<TInput, TOutput>,
  experimentId: string = options.id ?? `experiment-${Date.now()}`,
  variants: Record<string, VariantConfig<TInput, TOutput>> = normalizeVariants(options),
): Promise<ExperimentRecord> {
  const startedAtMs = Date.now()
  const cases: ExperimentCaseResult[] = []

  for (const testCase of options.suite.cases) {
    for (const [variantId, variant] of Object.entries(variants)) {
      const caseStart = Date.now()
      const caseSpan = observe.openSpan({
        name: `quality.case.${testCase.id}`,
        family: 'eval',
        primitive: 'eval.case',
        attributes: {
          qualityId,
          experimentId,
          suiteId: options.suite.id,
          caseId: testCase.id,
          caseName: testCase.name ?? testCase.id,
          variantId,
          targetId: targetId(variant.target),
          scorerCount: options.scorers?.length ?? 0,
          hasExpected: testCase.expected !== undefined,
          hasExpectation: testCase.expect !== undefined,
          hasReplay: options.replay !== undefined,
        },
      })
      const scores: QualityScore[] = []
      let status: ExperimentCaseResult['status'] = 'passed'
      let output: TOutput | undefined
      let assertion: ExperimentCaseResult['assertion'] | undefined
      let errorMessage: string | undefined
      let usage: JsonValue | undefined
      let cost: number | undefined
      let traceId: string | undefined

      await caseSpan.withContext(async () => {
        try {
          output = await runTargetWithReplay(variant.target, testCase.input, {
            replay: options.replay,
            caseId: testCase.id,
            settings: variant.settings,
            model: variant.model,
          })
          const assertionErrors: string[] = []
          let evaluatedAssertion = false
          if (testCase.expected) {
            evaluatedAssertion = true
            try {
              evaluateExpected(testCase.expected, output)
            } catch (error) {
              assertionErrors.push(errorToMessage(error))
            }
          }
          if (testCase.expect) {
            evaluatedAssertion = true
            try {
              await testCase.expect(
                createExpectationContext({
                  suiteId: options.suite.id,
                  experimentId,
                  testCase,
                  variant,
                  variantId,
                  output,
                }),
              )
            } catch (error) {
              assertionErrors.push(errorToMessage(error))
            }
          }
          if (evaluatedAssertion) {
            if (assertionErrors.length > 0) {
              status = 'failed'
              assertion = { passed: false, error: assertionErrors.join('\n') }
            } else {
              assertion = { passed: true }
            }
          }
          for (const scorer of options.scorers ?? []) {
            const score = await scorer.score({ input: testCase.input, output, caseId: testCase.id, variantId })
            scores.push(score)
            if ('passed' in score && score.passed === false) status = 'failed'
          }
          usage = extractOutputUsage(output)
          cost = extractOutputCost(output)
          traceId = extractOutputTraceId(output)
        } catch (error) {
          status = 'error'
          errorMessage = errorToMessage(error)
        }
      })

      const caseRecord = Object.freeze({
        caseId: testCase.id,
        caseName: testCase.name ?? testCase.id,
        variantId,
        status,
        input: toJsonValue(testCase.input),
        ...(output !== undefined ? { output: toJsonValue(output) } : {}),
        ...(usage !== undefined ? { usage } : {}),
        ...(cost !== undefined ? { cost } : {}),
        ...(traceId !== undefined ? { traceId } : {}),
        scores: Object.freeze(scores),
        ...(assertion ? { assertion } : {}),
        durationMs: Date.now() - caseStart,
        ...(errorMessage ? { error: errorMessage } : {}),
      })
      caseSpan.withContext(() => {
        emitEvalCaseArtifact(caseSpan.spanId, {
          qualityId,
          experimentId,
          suiteId: options.suite.id,
          targetId: targetId(variant.target),
          result: caseRecord,
        })
      })
      const endAttributes = {
        qualityId,
        experimentId,
        suiteId: options.suite.id,
        caseId: testCase.id,
        variantId,
        targetId: targetId(variant.target),
        status,
        scoreCount: scores.length,
        assertionPassed: assertion?.passed,
        durationMs: caseRecord.durationMs,
        traceId,
        hasOutput: output !== undefined,
      }
      if ((status as ExperimentCaseResult['status']) === 'error') {
        caseSpan.error(new Error(errorMessage ?? 'Quality case failed.'), endAttributes)
      } else {
        caseSpan.end(endAttributes)
      }
      cases.push(caseRecord)
    }
  }

  const endedAtMs = Date.now()
  const summary = summarizeCases(cases)
  return Object.freeze({
    _tag: 'Experiment' as const,
    id: experimentId,
    qualityId,
    suite: Object.freeze({
      id: options.suite.id,
      source: options.suite.source,
      caseCount: options.suite.cases.length,
      snapshot: Object.freeze(options.suite.cases.map((item) => toJsonValue(snapshotCase(item)))),
    }),
    ...(options.baseline ? { baselineVariantId: options.baseline } : {}),
    variants: Object.freeze(
      Object.entries(variants).map(([id, variant]) =>
        Object.freeze({
          id,
          targetId: targetId(variant.target),
          ...(variant.settings ? { settings: variant.settings } : {}),
        }),
      ),
    ),
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    status: summary.errored > 0 ? 'error' : summary.failed > 0 ? 'failed' : 'passed',
    summary,
    cases: Object.freeze(cases),
  })
}

function createExpectationContext<TInput extends Record<string, unknown>, TOutput>(input: {
  readonly suiteId: string
  readonly experimentId: string
  readonly testCase: QualityCase<TInput, TOutput>
  readonly variant: VariantConfig<TInput, TOutput>
  readonly variantId: string
  readonly output: TOutput
}): QualityExpectationContext<TInput, TOutput> {
  const traceId = extractOutputTraceId(input.output)
  const trace = extractOutputTrace(input.output)
  return Object.freeze({
    suiteId: input.suiteId,
    experimentId: input.experimentId,
    caseId: input.testCase.id,
    caseName: input.testCase.name ?? input.testCase.id,
    variantId: input.variantId,
    targetId: targetId(input.variant.target),
    input: input.testCase.input,
    output: input.output,
    ...(input.variant.model !== undefined ? { model: input.variant.model } : {}),
    ...(input.variant.settings !== undefined ? { settings: input.variant.settings } : {}),
    ...(traceId !== undefined ? { traceId } : {}),
    ...(trace !== undefined ? { trace } : {}),
    retrieval: Object.freeze({
      hits: Object.freeze([...extractRetrievalHits(input.output)]),
      ...extractRetrievalQuery(input.output),
    }),
    toolCalls: Object.freeze(normalizeToolCalls(extractToolCalls(input.output))),
    steps: Object.freeze(normalizeFlowSteps(extractFlowSteps(input.output))),
    citations: Object.freeze(extractCitations(input.output)),
    handoffs: Object.freeze(extractHandoffs(input.output)),
    artifacts: Object.freeze(extractArtifacts(input.output)),
    safety: Object.freeze({
      guardrails: Object.freeze(extractGuardrails(input.output)),
      constraints: Object.freeze(extractConstraints(input.output)),
    }),
    memory: Object.freeze(extractMemoryOperations(input.output)),
    workspace: Object.freeze(extractWorkspaceOperations(input.output)),
    routing: Object.freeze(extractRoutingReports(input.output)),
  })
}

function emitEvalCaseArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  input: {
    readonly qualityId: string
    readonly experimentId: string
    readonly suiteId: string
    readonly targetId: string
    readonly result: ExperimentCaseResult
  },
): void {
  const artifactId = observe.artifact({
    kind: 'score.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'score.report',
      verdict: input.result.status === 'passed' ? 'pass' : 'fail',
      qualityId: input.qualityId,
      experimentId: input.experimentId,
      suiteId: input.suiteId,
      targetId: input.targetId,
      caseId: input.result.caseId,
      caseName: input.result.caseName,
      variantId: input.result.variantId,
      status: input.result.status,
      scoreCount: input.result.scores.length,
      scores: input.result.scores,
      judges: input.result.scores.map((score) => ({
        name: score.name,
        ...(score.kind === 'numeric' ? { score: score.value, threshold: score.threshold } : {}),
        status: 'passed' in score && score.passed === false ? 'failed' : 'passed',
        ...('reasoning' in score && score.reasoning ? { rationale: score.reasoning } : {}),
      })),
      assertion: input.result.assertion,
      error: input.result.error,
      outputPreview:
        input.result.output === undefined ? undefined : truncateText(stringifyForAssertion(input.result.output), 500),
    },
    attributes: {
      primitive: 'eval.case',
      qualityId: input.qualityId,
      experimentId: input.experimentId,
      suiteId: input.suiteId,
      targetId: input.targetId,
      caseId: input.result.caseId,
      variantId: input.result.variantId,
      status: input.result.status,
      scoreCount: input.result.scores.length,
      assertionPassed: input.result.assertion?.passed,
      durationMs: input.result.durationMs,
      traceId: input.result.traceId,
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'eval.case', caseId: input.result.caseId, variantId: input.result.variantId },
  })
}

function feedbackInputAttributes(qualityId: string, input: QualityFeedbackInput): JsonRecord {
  return {
    qualityId,
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.experimentId ? { experimentId: input.experimentId } : {}),
    ...(input.caseId ? { caseId: input.caseId } : {}),
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
    hasComment: input.comment !== undefined,
    hasExpected: input.expected !== undefined,
    tagCount: input.tags?.length ?? 0,
    metadataKeys: input.metadata ? Object.keys(input.metadata).sort() : [],
  }
}

function emitFeedbackArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  record: QualityFeedbackRecord,
): void {
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      primitive: 'feedback.record',
      feedbackId: record.id,
      qualityId: record.qualityId,
      status: record.status,
      traceId: record.traceId,
      experimentId: record.experimentId,
      caseId: record.caseId,
      rating: record.rating,
      commentPreview: record.comment ? truncateText(record.comment, 500) : undefined,
      expected: record.expected,
      tags: record.tags,
      metadata: record.metadata,
    },
    attributes: {
      primitive: 'feedback.record',
      qualityId: record.qualityId,
      feedbackId: record.id,
      status: record.status,
      traceId: record.traceId,
      experimentId: record.experimentId,
      caseId: record.caseId,
      rating: record.rating,
      hasComment: record.comment !== undefined,
      hasExpected: record.expected !== undefined,
      tagCount: record.tags?.length ?? 0,
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'feedback.record', feedbackId: record.id },
  })
}

function truncateText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function normalizeVariants<TInput extends Record<string, unknown>, TOutput>(
  options: QualityEvaluateOptions<TInput, TOutput>,
): Record<string, VariantConfig<TInput, TOutput>> {
  if (options.variants && Object.keys(options.variants).length > 0) return options.variants
  if (!options.target) throw new Error('quality.evaluate(): provide either `target` or `variants`.')
  return { default: { target: options.target } }
}

async function runTarget<TInput extends Record<string, unknown>, TOutput>(
  target: QualityTarget<TInput, TOutput>,
  input: TInput,
): Promise<TOutput> {
  if (typeof target === 'function') return target(input)
  return target.run(input)
}

async function runTargetWithReplay<TInput extends Record<string, unknown>, TOutput>(
  target: QualityTarget<TInput, TOutput>,
  input: TInput,
  options: {
    readonly replay?: Cassette
    readonly caseId: string
    readonly settings?: JsonRecord
    readonly model?: unknown
  },
): Promise<TOutput> {
  if (!options.replay) return runTarget(target, input)
  return options.replay.run(
    {
      kind: targetCassetteKind(target),
      targetId: targetId(target),
      caseId: options.caseId,
      inputHash: hashJson(toJsonValue(input)),
      ...(options.settings ? { settingsHash: hashJson(options.settings) } : {}),
      ...(options.model !== undefined ? { model: String(options.model) } : {}),
    },
    () => runTarget(target, input),
  )
}

function targetId<TInput extends Record<string, unknown>, TOutput>(target: QualityTarget<TInput, TOutput>): string {
  if (typeof target === 'function') return target.name || 'anonymous'
  return target.id
}

function targetCassetteKind<TInput extends Record<string, unknown>, TOutput>(
  target: QualityTarget<TInput, TOutput>,
): CassetteBoundaryKind {
  if (typeof target === 'function') return 'generate'
  return target.cassetteKind ?? 'generate'
}

function extractOutputUsage(output: unknown): JsonValue | undefined {
  const record = objectRecord(output)
  const directUsage = record?.usage
  if (directUsage !== undefined) return toJsonValue(directUsage)
  const meta = objectRecord(record?._meta)
  return meta?.usage !== undefined ? toJsonValue(meta.usage) : undefined
}

function extractUsageRecord(
  source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown,
): JsonValue | undefined {
  if (isRecord(source) && source.usage !== undefined) return toJsonValue(source.usage)
  return extractOutputUsage(expectSourceValue(source))
}

function usageTotalTokens(usage: JsonValue | undefined): number | undefined {
  const usageRecord = objectRecord(usage)
  if (!usageRecord) return undefined
  for (const key of ['totalTokens', 'tokens', 'total', 'tokenCount']) {
    const value = usageRecord[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  const inputTokens = usageRecord.inputTokens
  const outputTokens = usageRecord.outputTokens
  if (typeof inputTokens === 'number' && typeof outputTokens === 'number') return inputTokens + outputTokens
  return undefined
}

function extractOutputCost(output: unknown): number | undefined {
  const record = objectRecord(output)
  const directCost = record?.cost
  if (typeof directCost === 'number' && Number.isFinite(directCost)) return directCost
  const meta = objectRecord(record?._meta)
  const metaCost = meta?.cost
  return typeof metaCost === 'number' && Number.isFinite(metaCost) ? metaCost : undefined
}

function extractCostValue(
  source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown,
): number | undefined {
  if (isRecord(source)) {
    const cost = source.cost
    if (typeof cost === 'number' && Number.isFinite(cost)) return cost
  }
  return extractOutputCost(expectSourceValue(source))
}

function extractModelValue(
  source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown,
): string | undefined {
  if (isRecord(source)) {
    const model = source.model
    if (typeof model === 'string') return model
  }
  const output = expectSourceValue(source)
  const record = objectRecord(output)
  for (const value of [
    record?.model,
    record?.modelId,
    objectRecord(record?._meta)?.actualModelId,
    objectRecord(record?._meta)?.model,
  ]) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function extractFallbackUsed(source: QualityExpectationContext<Record<string, unknown>, unknown> | unknown): boolean {
  const output = expectSourceValue(source)
  const fallback = objectRecord(objectRecord(output)?._meta)?.fallback ?? objectRecord(output)?.fallback
  if (typeof fallback === 'boolean') return fallback
  const record = objectRecord(fallback)
  if (!record) return false
  const attempts = record.attempts
  if (typeof attempts === 'number' && attempts > 1) return true
  const failedModels = record.failedModels
  return Array.isArray(failedModels) && failedModels.length > 0
}

function extractOutputTraceId(output: unknown): string | undefined {
  const meta = objectRecord(objectRecord(output)?._meta)
  const traceId = meta?.traceId
  return typeof traceId === 'string' && traceId.trim() ? traceId : undefined
}

function extractOutputTrace(output: unknown): unknown {
  const record = objectRecord(output)
  if (record && record.trace !== undefined) return record.trace
  return objectRecord(record?._meta)?.trace
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

type MutableVariantSummary = Record<string, { total: number; passed: number; failed: number; errored: number }>

function summarizeCases(cases: readonly ExperimentCaseResult[]): ExperimentRecord['summary'] {
  const byVariant: MutableVariantSummary = {}
  let passed = 0
  let failed = 0
  let errored = 0

  for (const item of cases) {
    if (!byVariant[item.variantId]) byVariant[item.variantId] = { total: 0, passed: 0, failed: 0, errored: 0 }
    byVariant[item.variantId].total++
    if (item.status === 'passed') {
      passed++
      byVariant[item.variantId].passed++
    } else if (item.status === 'failed') {
      failed++
      byVariant[item.variantId].failed++
    } else {
      errored++
      byVariant[item.variantId].errored++
    }
  }

  return Object.freeze({
    total: cases.length,
    passed,
    failed,
    errored,
    byVariant,
  })
}

async function writeExperiment(dir: string, experiment: ExperimentRecord): Promise<void> {
  const experimentsDir = join(dir, 'experiments')
  await mkdir(experimentsDir, { recursive: true })
  await writeFile(
    join(experimentsDir, `${safeFileName(experiment.id)}.json`),
    `${JSON.stringify(experiment, null, 2)}\n`,
  )
}

async function writeComparison(dir: string, comparison: QualityComparisonRecord): Promise<void> {
  const comparisonsDir = join(dir, 'comparisons')
  await mkdir(comparisonsDir, { recursive: true })
  await writeFile(
    join(comparisonsDir, `${safeFileName(comparison.id)}.json`),
    `${JSON.stringify(comparison, null, 2)}\n`,
  )
}

async function writeBaseline(dir: string, baseline: QualityBaselineRecord): Promise<void> {
  const baselinesDir = join(dir, 'baselines')
  await mkdir(baselinesDir, { recursive: true })
  await writeFile(join(baselinesDir, `${safeFileName(baseline.id)}.json`), `${JSON.stringify(baseline, null, 2)}\n`)
}

async function runCassetteBoundary<TOutput>(
  config: CassetteConfig,
  request: CassetteRequest,
  execute: () => Promise<TOutput>,
): Promise<TOutput> {
  const fixture = await readCassetteFile(config.path)
  const existing = findCassetteEntry(fixture, request)
  const shouldUpdateCase = config.mode === 'update' && shouldCassetteUpdateCase(config, request.caseId)

  if ((config.mode === 'replay' || config.mode === 'ci') && !existing) {
    throw new CassetteReplayError(`cassette(${config.mode}): missing entry for ${cassetteRequestLabel(request)}.`)
  }
  if (
    existing &&
    !shouldUpdateCase &&
    (config.mode === 'replay' || config.mode === 'ci' || config.mode === 'auto' || config.mode === 'update')
  ) {
    if (existing.response.error) throw new CassetteReplayError(existing.response.error.message)
    return existing.response.output as TOutput
  }
  if (config.mode === 'update' && !shouldUpdateCase) {
    throw new CassetteReplayError(
      `cassette(update): entry for ${cassetteRequestLabel(request)} is outside selected update cases.`,
    )
  }

  const recordedAt = new Date().toISOString()
  try {
    const output = await execute()
    await writeCassetteEntry(config, fixture, {
      id: `cassette-${hashJson(toJsonValue(request)).slice(0, 16)}`,
      ...(request.caseId ? { caseId: request.caseId } : {}),
      request,
      response: { output: toJsonValue(output) },
      recordedAt,
      redactionVersion: config.redactionVersion ?? 'v1',
    })
    return output
  } catch (error) {
    await writeCassetteEntry(config, fixture, {
      id: `cassette-${hashJson(toJsonValue(request)).slice(0, 16)}`,
      ...(request.caseId ? { caseId: request.caseId } : {}),
      request,
      response: {
        error: {
          ...(error instanceof Error && error.name ? { name: error.name } : {}),
          message: errorToMessage(error),
          ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        },
      },
      recordedAt,
      redactionVersion: config.redactionVersion ?? 'v1',
    })
    throw error
  }
}

async function readCassetteFile(path: string): Promise<CassetteFile> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (isCassetteFile(parsed)) return parsed
    throw new Error(`cassette(): invalid cassette file at ${path}.`)
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return Object.freeze({ _tag: 'Cassette' as const, version: 1 as const, entries: Object.freeze([]) })
    }
    throw error
  }
}

async function writeCassetteEntry(config: CassetteConfig, fixture: CassetteFile, entry: CassetteEntry): Promise<void> {
  const entries = fixture.entries.filter((item) => !sameCassetteRequest(item.request, entry.request))
  entries.push(Object.freeze(entry))
  const next: CassetteFile = Object.freeze({
    _tag: 'Cassette' as const,
    version: 1 as const,
    entries: Object.freeze(entries),
  })
  await mkdir(dirname(config.path), { recursive: true })
  await writeFile(config.path, `${JSON.stringify(next, null, 2)}\n`)
}

function findCassetteEntry(fixture: CassetteFile, request: CassetteRequest): CassetteEntry | undefined {
  return fixture.entries.find((entry) => sameCassetteRequest(entry.request, request))
}

function sameCassetteRequest(left: CassetteRequest, right: CassetteRequest): boolean {
  return stableJson(toJsonValue(left)) === stableJson(toJsonValue(right))
}

function shouldCassetteUpdateCase(config: CassetteConfig, caseId: string | undefined): boolean {
  if (!config.cases || config.cases.length === 0) return true
  return Boolean(caseId && config.cases.includes(caseId))
}

function cassetteRequestLabel(request: CassetteRequest): string {
  return `${request.kind}${request.targetId ? `:${request.targetId}` : ''}${request.caseId ? ` case ${request.caseId}` : ''}`
}

function createFeedbackRecord(
  qualityId: string,
  input: QualityFeedbackInput,
  redactions: readonly string[],
): QualityFeedbackRecord {
  const createdAt = new Date().toISOString()
  const metadata = input.metadata ? redactJsonRecord(input.metadata, redactions, 'metadata') : undefined
  return Object.freeze({
    _tag: 'QualityFeedback' as const,
    id: `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    qualityId,
    createdAt,
    status: 'new' as const,
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.experimentId ? { experimentId: input.experimentId } : {}),
    ...(input.caseId ? { caseId: input.caseId } : {}),
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
    ...(input.comment ? { comment: input.comment } : {}),
    ...(input.expected ? { expected: redactJsonRecord(input.expected, redactions, 'expected') } : {}),
    ...(input.tags ? { tags: Object.freeze([...input.tags]) } : {}),
    ...(metadata ? { metadata } : {}),
  })
}

async function appendFeedbackRecord(dir: string, record: QualityFeedbackRecord): Promise<void> {
  const feedbackDir = join(dir, 'feedback')
  await mkdir(feedbackDir, { recursive: true })
  await appendFile(join(feedbackDir, 'inbox.jsonl'), `${JSON.stringify(record)}\n`)
}

async function readFeedbackRecords(dir: string): Promise<QualityFeedbackRecord[]> {
  let raw: string
  try {
    raw = await readFile(join(dir, 'feedback', 'inbox.jsonl'), 'utf8')
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return []
    throw error
  }
  const records: QualityFeedbackRecord[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const parsed = JSON.parse(line) as unknown
    if (isQualityFeedbackRecord(parsed)) records.push(parsed)
  }
  return records
}

async function createFeedbackAnnotationRecord(
  qualityId: string,
  dir: string,
  input: QualityFeedbackAnnotationInput,
  redactions: readonly string[],
): Promise<QualityFeedbackAnnotationRecord> {
  if (!input.feedbackId.trim()) throw new Error('quality.feedback.annotate(): feedbackId must be non-empty.')
  const feedbackRecords = await readFeedbackRecords(dir)
  if (!feedbackRecords.some((record) => record.id === input.feedbackId)) {
    throw new Error(`quality.feedback.annotate(): feedback "${input.feedbackId}" was not found.`)
  }
  const createdAt = new Date().toISOString()
  return Object.freeze({
    _tag: 'QualityFeedbackAnnotation' as const,
    id: `feedback-annotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    qualityId,
    feedbackId: input.feedbackId,
    createdAt,
    ...(input.status ? { status: input.status } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.expected ? { expected: redactJsonRecord(input.expected, redactions, 'expected') } : {}),
    ...(input.tags ? { tags: Object.freeze([...input.tags]) } : {}),
    ...(input.metadata ? { metadata: redactJsonRecord(input.metadata, redactions, 'metadata') } : {}),
  })
}

async function appendFeedbackAnnotationRecord(dir: string, record: QualityFeedbackAnnotationRecord): Promise<void> {
  const feedbackDir = join(dir, 'feedback')
  await mkdir(feedbackDir, { recursive: true })
  await appendFile(join(feedbackDir, 'annotations.jsonl'), `${JSON.stringify(record)}\n`)
}

async function readFeedbackAnnotationRecords(dir: string): Promise<QualityFeedbackAnnotationRecord[]> {
  let raw: string
  try {
    raw = await readFile(join(dir, 'feedback', 'annotations.jsonl'), 'utf8')
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return []
    throw error
  }
  const records: QualityFeedbackAnnotationRecord[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const parsed = JSON.parse(line) as unknown
    if (isQualityFeedbackAnnotationRecord(parsed)) records.push(parsed)
  }
  return records
}

async function createFeedbackMemoryProposalRecord(
  qualityId: string,
  dir: string,
  input: QualityFeedbackMemoryProposalInput,
  redactions: readonly string[],
): Promise<QualityFeedbackMemoryProposalRecord> {
  if (!input.feedbackId.trim()) throw new Error('quality.feedback.proposeMemory(): feedbackId must be non-empty.')
  const feedbackRecords = await readFeedbackRecords(dir)
  if (!feedbackRecords.some((record) => record.id === input.feedbackId)) {
    throw new Error(`quality.feedback.proposeMemory(): feedback "${input.feedbackId}" was not found.`)
  }
  const createdAt = new Date().toISOString()
  return Object.freeze({
    _tag: 'QualityFeedbackMemoryProposal' as const,
    id: `feedback-memory-proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    qualityId,
    feedbackId: input.feedbackId,
    createdAt,
    status: 'proposed' as const,
    ...(input.memoryId ? { memoryId: input.memoryId } : {}),
    ...(input.memoryKind ? { memoryKind: input.memoryKind } : {}),
    proposal: redactJsonRecord(input.proposal, redactions, 'proposal'),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.tags ? { tags: Object.freeze([...input.tags]) } : {}),
    ...(input.metadata ? { metadata: redactJsonRecord(input.metadata, redactions, 'metadata') } : {}),
  })
}

async function appendFeedbackMemoryProposalRecord(
  dir: string,
  record: QualityFeedbackMemoryProposalRecord,
): Promise<void> {
  const feedbackDir = join(dir, 'feedback')
  await mkdir(feedbackDir, { recursive: true })
  await appendFile(join(feedbackDir, 'memory-proposals.jsonl'), `${JSON.stringify(record)}\n`)
}

async function readFeedbackMemoryProposalRecords(dir: string): Promise<QualityFeedbackMemoryProposalRecord[]> {
  let raw: string
  try {
    raw = await readFile(join(dir, 'feedback', 'memory-proposals.jsonl'), 'utf8')
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return []
    throw error
  }
  const records: QualityFeedbackMemoryProposalRecord[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const parsed = JSON.parse(line) as unknown
    if (isQualityFeedbackMemoryProposalRecord(parsed)) records.push(parsed)
  }
  return records
}

async function exportFeedbackSuite(dir: string, options: QualityFeedbackSuiteOptions): Promise<PortableSuiteJson> {
  if (!options.id.trim()) throw new Error('quality.feedback.exportSuite(): suite id must be non-empty.')
  if (options.feedbackIds.length === 0) {
    throw new Error('quality.feedback.exportSuite(): feedbackIds must be non-empty.')
  }

  const feedbackRecords = await readFeedbackRecords(dir)
  const byId = new Map(feedbackRecords.map((record) => [record.id, record]))
  const cases: Array<PortableSuiteJson['cases'][number]> = []

  for (const feedbackId of options.feedbackIds) {
    const feedback = byId.get(feedbackId)
    if (!feedback) throw new Error(`quality.feedback.exportSuite(): feedback "${feedbackId}" was not found.`)
    const input = options.inputs?.[feedback.id] ?? null
    if (!input) {
      throw new Error(
        `quality.feedback.exportSuite(): feedback "${feedback.id}" has no input. Provide inputs["${feedback.id}"]; linked trace input is resolved by the devtools backend from canonical observability records.`,
      )
    }
    const tags = mergedFeedbackTags(feedback, options.tag)

    cases.push(
      Object.freeze({
        id: feedback.caseId ?? feedback.id,
        input,
        ...(feedback.expected ? { expected: feedback.expected } : {}),
        ...(tags.length > 0 ? { tags: Object.freeze(tags) } : {}),
        ...(options.includeFeedbackMetadata ? { metadata: feedbackExportMetadata(feedback) } : {}),
      }),
    )
  }

  return Object.freeze({
    id: options.id,
    ...(options.description ? { description: options.description } : {}),
    cases: Object.freeze(cases),
  })
}

function mergedFeedbackTags(feedback: QualityFeedbackRecord, tag: string | undefined): readonly string[] {
  return [...new Set([...(feedback.tags ?? []), ...(tag ? [tag] : [])])]
}

function feedbackExportMetadata(feedback: QualityFeedbackRecord): JsonRecord {
  return {
    qualityFeedbackId: feedback.id,
    ...(feedback.traceId ? { traceId: feedback.traceId } : {}),
    ...(feedback.experimentId ? { experimentId: feedback.experimentId } : {}),
    ...(feedback.rating !== undefined ? { rating: feedback.rating } : {}),
  }
}

function redactJsonRecord(input: JsonRecord, paths: readonly string[], root: string): JsonRecord {
  const cloned = cloneJsonRecord(input)
  for (const path of paths) {
    const parts = path.split('.').filter(Boolean)
    if (parts[0] !== root) continue
    redactAtPath(cloned, parts.slice(1))
  }
  return cloned
}

function cloneJsonRecord(input: JsonRecord): JsonRecord {
  return JSON.parse(JSON.stringify(input)) as JsonRecord
}

function redactAtPath(value: JsonRecord, parts: readonly string[]): void {
  if (parts.length === 0) return
  const [head, ...tail] = parts
  if (tail.length === 0) {
    if (head in value) (value as Record<string, JsonValue>)[head] = '[redacted]'
    return
  }
  const next = value[head]
  if (isJsonObject(next)) {
    redactAtPath(next, tail)
  }
}

async function resolveComparisonSide(
  input: QualityComparisonSideInput,
  getExperiment: (id: string) => Promise<ExperimentRecord | null>,
): Promise<{ readonly experiment: ExperimentRecord; readonly summary: QualityComparisonSummary }> {
  if (typeof input === 'string' || isExperimentRecord(input)) {
    const experiment = await resolveExperiment(input, getExperiment)
    return { experiment, summary: summarizeExperimentForComparison(experiment) }
  }
  const experiment = await resolveExperiment(input.experiment, getExperiment)
  return {
    experiment,
    summary: summarizeExperimentForComparison(experiment, input.variantId, input.label),
  }
}

async function resolveExperiment(
  input: string | ExperimentRecord,
  getExperiment: (id: string) => Promise<ExperimentRecord | null>,
): Promise<ExperimentRecord> {
  if (isExperimentRecord(input)) return input
  const experiment = await getExperiment(input)
  if (!experiment) throw new Error(`quality(): experiment "${input}" was not found.`)
  return experiment
}

function summarizeExperimentForComparison(
  experiment: ExperimentRecord,
  variantId?: string,
  label?: string,
): QualityComparisonSummary {
  const cases = variantId ? experiment.cases.filter((item) => item.variantId === variantId) : [...experiment.cases]
  if (variantId && cases.length === 0) {
    throw new Error(`quality(): variant "${variantId}" was not found in experiment "${experiment.id}".`)
  }

  const total = cases.length
  const passed = cases.filter((item) => item.status === 'passed').length
  const failed = cases.filter((item) => item.status === 'failed').length
  const errored = cases.filter((item) => item.status === 'error').length
  const avgDurationMs = total === 0 ? 0 : cases.reduce((sum, item) => sum + item.durationMs, 0) / total
  const numericScores = averageNumericScores(cases)

  return Object.freeze({
    experimentId: experiment.id,
    ...(variantId ? { variantId } : {}),
    ...(label ? { label } : {}),
    total,
    passed,
    failed,
    errored,
    passRate: total === 0 ? 0 : passed / total,
    avgDurationMs,
    numericScores,
  })
}

function averageNumericScores(cases: readonly ExperimentCaseResult[]): Record<string, number> {
  const sums: Record<string, { sum: number; count: number }> = {}
  for (const item of cases) {
    for (const score of item.scores) {
      if (score.kind !== 'numeric') continue
      const current = sums[score.name] ?? { sum: 0, count: 0 }
      sums[score.name] = { sum: current.sum + score.value, count: current.count + 1 }
    }
  }
  const averages: Record<string, number> = {}
  for (const [name, value] of Object.entries(sums)) averages[name] = value.count === 0 ? 0 : value.sum / value.count
  return averages
}

function compareSummaries(
  baseline: QualityComparisonSummary,
  candidate: QualityComparisonSummary,
): QualityComparisonRecord['metrics'] {
  const numericScoreDeltas: QualityComparisonRecord['metrics']['numericScoreDeltas'] = {}
  const names = new Set([...Object.keys(baseline.numericScores), ...Object.keys(candidate.numericScores)])
  for (const name of names) {
    const baselineScore = baseline.numericScores[name]
    const candidateScore = candidate.numericScores[name]
    numericScoreDeltas[name] = {
      ...(baselineScore !== undefined ? { baseline: baselineScore } : {}),
      ...(candidateScore !== undefined ? { candidate: candidateScore } : {}),
      ...(baselineScore !== undefined && candidateScore !== undefined ? { delta: candidateScore - baselineScore } : {}),
    }
  }
  return Object.freeze({
    passRateDelta: candidate.passRate - baseline.passRate,
    avgDurationMsDelta: candidate.avgDurationMs - baseline.avgDurationMs,
    numericScoreDeltas,
  })
}

function comparisonStatus(metrics: QualityComparisonRecord['metrics']): QualityComparisonRecord['status'] {
  const passRateEpsilon = 0.000001
  if (metrics.passRateDelta > passRateEpsilon) return 'candidate_better'
  if (metrics.passRateDelta < -passRateEpsilon) return 'candidate_worse'
  const scoreDeltas = Object.values(metrics.numericScoreDeltas)
    .map((item) => item.delta)
    .filter((value): value is number => typeof value === 'number')
  if (scoreDeltas.length === 0 || scoreDeltas.every((item) => Math.abs(item) <= passRateEpsilon)) return 'same'
  const positive = scoreDeltas.some((item) => item > passRateEpsilon)
  const negative = scoreDeltas.some((item) => item < -passRateEpsilon)
  if (positive && negative) return 'mixed'
  return positive ? 'candidate_better' : 'candidate_worse'
}

function evaluateComparisonGates(
  metrics: QualityComparisonRecord['metrics'],
  candidate: QualityComparisonSummary,
  gates: QualityComparisonGates,
): QualityGateSummary {
  const results: QualityGateResult[] = []
  if (gates.passRate?.min !== undefined) {
    results.push(gateResult('passRate.min', candidate.passRate, gates.passRate.min, 'gte'))
  }
  if (gates.passRate?.minDelta !== undefined) {
    results.push(gateResult('passRate.minDelta', metrics.passRateDelta, gates.passRate.minDelta, 'gte'))
  }
  if (gates.avgDurationMs?.max !== undefined) {
    results.push(gateResult('avgDurationMs.max', candidate.avgDurationMs, gates.avgDurationMs.max, 'lte'))
  }
  if (gates.avgDurationMs?.maxDelta !== undefined) {
    results.push(gateResult('avgDurationMs.maxDelta', metrics.avgDurationMsDelta, gates.avgDurationMs.maxDelta, 'lte'))
  }
  for (const [name, scoreGate] of Object.entries(gates.numericScores ?? {})) {
    const score = candidate.numericScores[name]
    const delta = metrics.numericScoreDeltas[name]?.delta
    if (scoreGate.min !== undefined) {
      results.push(gateResult(`numericScores.${name}.min`, score ?? Number.NEGATIVE_INFINITY, scoreGate.min, 'gte'))
    }
    if (scoreGate.max !== undefined) {
      results.push(gateResult(`numericScores.${name}.max`, score ?? Number.POSITIVE_INFINITY, scoreGate.max, 'lte'))
    }
    if (scoreGate.minDelta !== undefined) {
      results.push(
        gateResult(`numericScores.${name}.minDelta`, delta ?? Number.NEGATIVE_INFINITY, scoreGate.minDelta, 'gte'),
      )
    }
  }
  return Object.freeze({
    status: results.every((item) => item.passed) ? 'passed' : 'failed',
    results: Object.freeze(results),
  })
}

function gateResult(
  name: string,
  actual: number,
  expected: number,
  operator: QualityGateResult['operator'],
): QualityGateResult {
  return Object.freeze({
    name,
    actual,
    expected,
    operator,
    passed: operator === 'gte' ? actual >= expected : actual <= expected,
  })
}

async function readTaggedRecord<TRecord>(
  path: string,
  predicate: (value: unknown) => value is TRecord,
): Promise<TRecord | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return predicate(parsed) ? parsed : null
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return null
    throw error
  }
}

async function listTaggedRecords<TRecord>(
  dir: string,
  predicate: (value: unknown) => value is TRecord,
): Promise<TRecord[]> {
  let files: string[]
  try {
    files = await readdir(dir)
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return []
    throw error
  }
  const records: TRecord[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const raw = await readFile(join(dir, file), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (predicate(parsed)) records.push(parsed)
  }
  return records
}

function snapshotCase<TInput extends Record<string, unknown>, TOutput>(
  testCase: QualityCase<TInput, TOutput>,
): JsonRecord {
  return {
    id: testCase.id,
    ...(testCase.name ? { name: testCase.name } : {}),
    input: toJsonValue(testCase.input),
    ...(testCase.expected ? { expected: testCase.expected } : {}),
    ...(testCase.tags ? { tags: [...testCase.tags] } : {}),
    ...(testCase.metadata ? { metadata: testCase.metadata } : {}),
  }
}

function evaluateExpected(expected: JsonRecord, output: unknown): void {
  const jsonOutput = toJsonValue(output)
  if ('contains' in expected) {
    assertContains('expected.contains', jsonOutput, expected.contains)
  }
  if ('equals' in expected) {
    assertJsonEqual('expected.equals', jsonOutput, expected.equals)
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (key === 'contains' || key === 'equals') continue
    if (!isJsonObject(jsonOutput) || !(key in jsonOutput)) {
      throw new Error(`Expected output to include field "${key}".`)
    }
    assertExpectedField(key, jsonOutput[key], expectedValue)
  }
}

function extractRetrievalHits(output: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(output)) return output.filter(isRecord)
  const record = objectRecord(output)
  const candidates = [
    record?.hits,
    record?.retrieval,
    objectRecord(record?.retrieval)?.hits,
    objectRecord(record?.grounding)?.hits,
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter(isRecord)
  }
  return []
}

function extractRetrievalQuery(output: unknown): { readonly query?: string } {
  const record = objectRecord(output)
  const directQuery = record?.query
  if (typeof directQuery === 'string') return { query: directQuery }
  const retrievalQuery = objectRecord(record?.retrieval)?.query
  if (typeof retrievalQuery === 'string') return { query: retrievalQuery }
  const groundingQuery = objectRecord(record?.grounding)?.query
  return typeof groundingQuery === 'string' ? { query: groundingQuery } : {}
}

function retrievalHitMatches(hit: Record<string, unknown>, expected: ExpectedRetrievalHit): boolean {
  if (expected.namespace && hit.namespace !== expected.namespace) return false
  if (expected.sourceId && hit.sourceId !== expected.sourceId) return false
  if (expected.chunkId && hit.chunkId !== expected.chunkId) return false
  if (expected.metadata) {
    const metadata = objectRecord(hit.metadata)
    if (!metadata) return false
    for (const [key, expectedValue] of Object.entries(expected.metadata)) {
      if (stableJson(toJsonValue(metadata[key])) !== stableJson(expectedValue)) return false
    }
  }
  return true
}

function extractToolCalls(output: unknown): readonly Record<string, unknown>[] {
  const calls: Record<string, unknown>[] = []
  visitRecords(output, (record) => {
    for (const key of ['toolCalls', 'tools']) {
      const value = record[key]
      if (Array.isArray(value)) calls.push(...value.filter(isRecord))
    }
    if (looksLikeToolCall(record)) calls.push(record)
  })
  return dedupeRecords(calls)
}

function normalizeToolCalls(calls: readonly Record<string, unknown>[]): readonly QualityToolCallExecution[] {
  const normalized: QualityToolCallExecution[] = []
  for (const call of calls) {
    const name = toolCallName(call)
    if (!name) continue
    const id = firstString(call.id, call.toolCallId, call.callId)
    const args = toolCallArgs(call)
    const result = call.result ?? call.output
    normalized.push(
      Object.freeze({
        ...(id ? { id } : {}),
        name,
        ...(args !== undefined ? { args } : {}),
        ...(result !== undefined ? { result } : {}),
      }),
    )
  }
  return Object.freeze(normalized)
}

function looksLikeToolCall(record: Record<string, unknown>): boolean {
  if (typeof record.toolName === 'string' || typeof record.tool === 'string' || typeof record.toolCallId === 'string') {
    return true
  }
  if (typeof record.name !== 'string') return false
  return (
    'args' in record ||
    'input' in record ||
    'arguments' in record ||
    'result' in record ||
    'output' in record ||
    'error' in record ||
    'exception' in record
  )
}

function toolCallName(record: Record<string, unknown>): string | undefined {
  for (const key of ['name', 'toolName', 'tool']) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function toolCallArgs(record: Record<string, unknown>): unknown {
  return record.args ?? record.input ?? record.arguments ?? {}
}

function toolCallResult(record: Record<string, unknown>): unknown {
  return record.result ?? record.output ?? record.response
}

function toolCallFailed(record: Record<string, unknown>): boolean {
  const status = record.status
  if (typeof status === 'string' && ['error', 'failed', 'failure'].includes(status.toLowerCase())) return true
  return record.error !== undefined || record.exception !== undefined
}

function deepJsonEqual(actual: unknown, expected: unknown): boolean {
  return stableJson(toJsonValue(actual)) === stableJson(toJsonValue(expected))
}

function containsSubsequence(actual: readonly string[], expected: readonly string[]): boolean {
  if (expected.length === 0) return true
  let expectedIndex = 0
  for (const name of actual) {
    if (name === expected[expectedIndex]) expectedIndex += 1
    if (expectedIndex === expected.length) return true
  }
  return false
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function schemaErrorMessage(error: unknown): string {
  const issues = objectRecord(error)?.issues
  if (Array.isArray(issues) && issues.length > 0) {
    return issues.map(schemaIssueMessage).join('; ')
  }
  return errorToMessage(error)
}

function schemaIssueMessage(issue: unknown): string {
  const record = objectRecord(issue)
  if (!record) return stringifyForAssertion(toJsonValue(issue))
  const path = Array.isArray(record.path) ? record.path.map(String).join('.') : ''
  const message = typeof record.message === 'string' ? record.message : stringifyForAssertion(toJsonValue(issue))
  return path ? `${path}: ${message}` : message
}

function extractFlowSteps(output: unknown): readonly Record<string, unknown>[] {
  const steps: Record<string, unknown>[] = []
  visitRecords(output, (record) => {
    const directSteps = record.steps
    if (Array.isArray(directSteps)) steps.push(...directSteps.filter(isRecord))
    const stepResults = objectRecord(record.stepResults)
    if (stepResults) {
      for (const [id, value] of Object.entries(stepResults)) {
        if (isRecord(value)) steps.push({ id, ...value })
      }
    }
    if (looksLikeFlowStep(record)) steps.push(record)
  })
  return dedupeRecords(steps)
}

function normalizeFlowSteps(steps: readonly Record<string, unknown>[]): readonly QualityStepExecution[] {
  const normalized: QualityStepExecution[] = []
  for (const step of steps) {
    const id = flowStepId(step)
    if (!id) continue
    const name = firstString(step.name)
    const status = flowStepStatus(step)
    const output = step.output ?? step.result
    const error = step.error
    const toolCalls = normalizeToolCalls(extractToolCalls(step))
    normalized.push(
      Object.freeze({
        id,
        ...(name ? { name } : {}),
        ...(status ? { status } : {}),
        ...(output !== undefined ? { output } : {}),
        ...(error !== undefined ? { error } : {}),
        toolCalls,
      }),
    )
  }
  return Object.freeze(normalized)
}

function looksLikeFlowStep(record: Record<string, unknown>): boolean {
  return (typeof record.id === 'string' || typeof record.name === 'string') && 'status' in record
}

function flowStepId(record: Record<string, unknown>): string | undefined {
  const id = record.id ?? record.name ?? record.stepId
  return typeof id === 'string' ? id : undefined
}

function flowStepStatus(record: Record<string, unknown>): string | undefined {
  const status = record.status ?? record.state
  return typeof status === 'string' ? status : undefined
}

function extractCitations(output: unknown): readonly QualityCitationExecution[] {
  const citations: QualityCitationExecution[] = []
  visitRecords(output, (record) => {
    for (const key of ['citations', 'resolvedCitations']) {
      const value = record[key]
      if (Array.isArray(value)) {
        for (const item of value) {
          const citation = normalizeCitation(item)
          if (citation) citations.push(citation)
        }
      }
    }
    const artifact = objectRecord(record.citationArtifact)
    const resolved = artifact?.resolvedCitations
    if (Array.isArray(resolved)) {
      for (const item of resolved) {
        const citation = normalizeCitation(item)
        if (citation) citations.push(citation)
      }
    }
  })
  return Object.freeze(dedupeCitations(citations))
}

function normalizeCitation(value: unknown): QualityCitationExecution | undefined {
  if (!isRecord(value)) return undefined
  const sourceId = value.sourceId
  if (typeof sourceId !== 'string' || !sourceId.trim()) return undefined
  const namespace = firstString(value.namespace)
  const chunkId = firstString(value.chunkId)
  const quote = firstString(value.quote)
  const url = firstString(value.url)
  const path = firstString(value.path, value.sourcePath)
  return Object.freeze({
    ...(namespace ? { namespace } : {}),
    sourceId,
    ...(chunkId ? { chunkId } : {}),
    ...(quote ? { quote } : {}),
    ...(url ? { url } : {}),
    ...(path ? { path } : {}),
  })
}

function dedupeCitations(citations: readonly QualityCitationExecution[]): readonly QualityCitationExecution[] {
  const seen = new Set<string>()
  const deduped: QualityCitationExecution[] = []
  for (const citation of citations) {
    const key = stableJson(toJsonValue(citation))
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(citation)
  }
  return Object.freeze(deduped)
}

function citationMatches(citation: QualityCitationExecution, expected: ExpectedCitation): boolean {
  if (expected.namespace && citation.namespace !== expected.namespace) return false
  if (citation.sourceId !== expected.sourceId) return false
  if (expected.chunkId && citation.chunkId !== expected.chunkId) return false
  if (expected.quote && citation.quote !== expected.quote) return false
  return true
}

function extractCitationQuoteText(output: unknown): string {
  const record = objectRecord(output)
  const direct = firstString(record?.text, record?.answer, record?.content, record?.message)
  if (direct) return direct
  return stringifyForAssertion(toJsonValue(output))
}

function extractArtifacts(output: unknown): readonly QualityArtifactExecution[] {
  const artifacts: QualityArtifactExecution[] = []
  visitRecords(output, (record) => {
    for (const key of ['artifacts', 'files', 'outputFiles']) {
      const value = record[key]
      if (Array.isArray(value)) {
        for (const item of value) {
          const artifact = normalizeArtifact(item)
          if (artifact) artifacts.push(artifact)
        }
      }
    }
    const artifact = normalizeArtifact(record)
    if (artifact) artifacts.push(artifact)
  })
  return Object.freeze(dedupeArtifacts(artifacts))
}

function normalizeArtifact(value: unknown): QualityArtifactExecution | undefined {
  if (!isRecord(value) || !looksLikeArtifact(value)) return undefined
  const id = firstString(value.id, value.artifactId, value.fileId)
  const kind = firstString(value.kind, value.artifactKind, value.type)
  const name = firstString(value.name, value.filename, value.title)
  const path = firstString(value.path, value.filePath, value.uri)
  const contentType = firstString(value.contentType, value.mimeType)
  const content = value.content ?? value.text ?? value.data
  const preview = value.preview
  const metadata = objectRecord(value.metadata)
  return Object.freeze({
    ...(id ? { id } : {}),
    ...(kind ? { kind } : {}),
    ...(name ? { name } : {}),
    ...(path ? { path } : {}),
    ...(contentType ? { contentType } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(preview !== undefined ? { preview } : {}),
    ...(metadata ? { metadata } : {}),
  })
}

function looksLikeArtifact(record: Record<string, unknown>): boolean {
  if (record.type === 'artifact' || typeof record.artifactId === 'string') return true
  if (
    typeof record.kind === 'string' &&
    ['content', 'preview', 'contentType', 'metadata'].some((key) => key in record)
  ) {
    return true
  }
  if (
    typeof record.path === 'string' &&
    ['content', 'text', 'data', 'contentType', 'mimeType'].some((key) => key in record)
  ) {
    return true
  }
  return false
}

function dedupeArtifacts(artifacts: readonly QualityArtifactExecution[]): readonly QualityArtifactExecution[] {
  const seen = new Set<string>()
  const deduped: QualityArtifactExecution[] = []
  for (const artifact of artifacts) {
    const key = stableJson(toJsonValue(artifact))
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(artifact)
  }
  return Object.freeze(deduped)
}

function artifactMatches(artifact: QualityArtifactExecution, expected: ExpectedArtifact): boolean {
  if (expected.id && artifact.id !== expected.id) return false
  if (expected.kind && artifact.kind !== expected.kind) return false
  if (expected.name && artifact.name !== expected.name) return false
  if (expected.path && artifact.path !== expected.path) return false
  if (expected.contentType && artifact.contentType !== expected.contentType) return false
  if (expected.metadata) {
    const metadata = artifact.metadata
    if (!metadata) return false
    for (const [key, expectedValue] of Object.entries(expected.metadata)) {
      if (!deepJsonEqual(metadata[key], expectedValue)) return false
    }
  }
  return true
}

function extractGuardrails(output: unknown): readonly QualityGuardrailExecution[] {
  const guardrails: QualityGuardrailExecution[] = []
  visitRecords(output, (record) => {
    for (const value of safetyArrayCandidates(record, 'guardrails')) {
      const guardrail = normalizeGuardrail(value)
      if (guardrail) guardrails.push(guardrail)
    }
    const guardrail = normalizeGuardrail(record)
    if (guardrail) guardrails.push(guardrail)
  })
  return Object.freeze(dedupeGuardrails(guardrails))
}

function normalizeGuardrail(value: unknown): QualityGuardrailExecution | undefined {
  if (!isRecord(value)) return undefined
  const action = firstString(value.action)
  const kind = firstString(value.kind)
  const hasGuardrailShape =
    kind === 'guardrail.report' ||
    typeof value.guardrailName === 'string' ||
    typeof value.guard === 'string' ||
    typeof value.guardrail === 'string' ||
    ('phase' in value && 'action' in value)
  if (!action || !hasGuardrailShape) return undefined
  const name = firstString(value.guardrailName, value.guard, value.guardrail, value.name)
  const phase = firstString(value.phase)
  const reason = firstString(value.reason)
  return Object.freeze({
    ...(name ? { name } : {}),
    ...(phase ? { phase } : {}),
    action,
    ...(reason ? { reason } : {}),
  })
}

function extractConstraints(output: unknown): readonly QualityConstraintExecution[] {
  const constraints: QualityConstraintExecution[] = []
  visitRecords(output, (record) => {
    for (const value of safetyArrayCandidates(record, 'constraints')) {
      const constraint = normalizeConstraint(value)
      if (constraint) constraints.push(constraint)
    }
    const constraint = normalizeConstraint(record)
    if (constraint) constraints.push(constraint)
  })
  return Object.freeze(dedupeConstraints(constraints))
}

function normalizeConstraint(value: unknown): QualityConstraintExecution | undefined {
  if (!isRecord(value)) return undefined
  const kind = firstString(value.kind)
  const hasConstraintShape =
    kind === 'constraint.report' ||
    typeof value.constraintName === 'string' ||
    typeof value.constraint === 'string' ||
    ('pass' in value && ('severity' in value || 'feedback' in value || 'attempts' in value))
  if (!hasConstraintShape) return undefined
  const name = firstString(value.constraintName, value.constraint, value.assertion, value.name)
  if (!name) return undefined
  const severity = firstString(value.severity)
  const feedback = firstString(value.feedback)
  const pass = typeof value.pass === 'boolean' ? value.pass : undefined
  const attempts = constraintAttempts(value.attempts)
  return Object.freeze({
    name,
    ...(severity ? { severity } : {}),
    ...(pass !== undefined ? { pass } : {}),
    ...(feedback ? { feedback } : {}),
    ...(attempts !== undefined ? { attempts } : {}),
  })
}

function safetyArrayCandidates(record: Record<string, unknown>, key: 'guardrails' | 'constraints'): readonly unknown[] {
  const direct = record[key]
  if (Array.isArray(direct)) return direct
  const meta = objectRecord(record._meta)
  const metaGroup = objectRecord(meta?.[key])
  if (key === 'guardrails') {
    const applied = metaGroup?.applied
    return Array.isArray(applied) ? applied : []
  }
  const entries = metaGroup?.entries
  return Array.isArray(entries) ? entries : []
}

function constraintAttempts(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.length
  return undefined
}

function dedupeGuardrails(guardrails: readonly QualityGuardrailExecution[]): readonly QualityGuardrailExecution[] {
  const seen = new Set<string>()
  const deduped: QualityGuardrailExecution[] = []
  for (const guardrail of guardrails) {
    const key = stableJson(toJsonValue(guardrail))
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(guardrail)
  }
  return Object.freeze(deduped)
}

function dedupeConstraints(constraints: readonly QualityConstraintExecution[]): readonly QualityConstraintExecution[] {
  const seen = new Set<string>()
  const deduped: QualityConstraintExecution[] = []
  for (const constraint of constraints) {
    const key = stableJson(toJsonValue(constraint))
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(constraint)
  }
  return Object.freeze(deduped)
}

function extractMemoryOperations(output: unknown): readonly QualityMemoryExecution[] {
  const operations: QualityMemoryExecution[] = []
  visitRecords(output, (record) => {
    for (const key of ['memory', 'memoryOperations']) {
      const value = record[key]
      const direct = Array.isArray(value) ? value : objectRecord(value)?.operations
      if (Array.isArray(direct)) {
        for (const item of direct) {
          const operation = normalizeMemoryOperation(item)
          if (operation) operations.push(operation)
        }
      }
    }
    const operation = normalizeMemoryOperation(record)
    if (operation) operations.push(operation)
  })
  return Object.freeze(dedupeMemoryOperations(operations))
}

function normalizeMemoryOperation(value: unknown): QualityMemoryExecution | undefined {
  if (!isRecord(value)) return undefined
  const primitive = firstString(value.primitive)
  const kind = firstString(value.kind)
  const operation = firstString(value.operation, value.op, value.action)
  const inferredOperation =
    operation ??
    (primitive === 'memory.read' || kind === 'memory.recall'
      ? 'read'
      : primitive === 'memory.write' || kind === 'memory.diff'
        ? 'write'
        : kind === 'memory.snapshot'
          ? 'snapshot'
          : undefined)
  if (!inferredOperation) return undefined
  const hasMemoryShape =
    primitive?.startsWith('memory.') ||
    kind?.startsWith('memory.') ||
    typeof value.memoryId === 'string' ||
    typeof value.blockId === 'string' ||
    typeof value.memory === 'string'
  if (!hasMemoryShape) return undefined
  const memoryId = firstString(value.memoryId, value.memory)
  const blockId = firstString(value.blockId, value.block, value.name)
  const key = firstString(value.key, value.path)
  const summary = firstString(value.summary)
  const preview = objectRecord(value.preview)
  const valueCandidate = value.value ?? value.data ?? value.content ?? preview?.data ?? preview?.value
  return Object.freeze({
    operation: normalizeOperationName(inferredOperation),
    ...(memoryId ? { memoryId } : {}),
    ...(blockId ? { blockId } : {}),
    ...(key ? { key } : {}),
    ...(valueCandidate !== undefined ? { value: valueCandidate } : {}),
    ...(summary ? { summary } : {}),
  })
}

function memoryOperationMatches(operation: QualityMemoryExecution, expected: ExpectedMemoryOperation): boolean {
  if (expected.operation && operation.operation !== normalizeOperationName(expected.operation)) return false
  if (expected.memoryId && operation.memoryId !== expected.memoryId) return false
  if (expected.blockId && operation.blockId !== expected.blockId) return false
  if (expected.key && operation.key !== expected.key) return false
  return true
}

function dedupeMemoryOperations(operations: readonly QualityMemoryExecution[]): readonly QualityMemoryExecution[] {
  const seen = new Set<string>()
  const deduped: QualityMemoryExecution[] = []
  for (const operation of operations) {
    const key = stableJson(toJsonValue(operation))
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(operation)
  }
  return Object.freeze(deduped)
}

function extractWorkspaceOperations(output: unknown): readonly QualityWorkspaceExecution[] {
  const operations: QualityWorkspaceExecution[] = []
  visitRecords(output, (record) => {
    for (const key of ['workspace', 'workspaceOperations']) {
      const value = record[key]
      const direct = Array.isArray(value) ? value : objectRecord(value)?.operations
      if (Array.isArray(direct)) {
        for (const item of direct) {
          const operation = normalizeWorkspaceOperation(item)
          if (operation) operations.push(operation)
        }
      }
    }
    const operation = normalizeWorkspaceOperation(record)
    if (operation) operations.push(operation)
  })
  return Object.freeze(dedupeWorkspaceOperations(operations))
}

function normalizeWorkspaceOperation(value: unknown): QualityWorkspaceExecution | undefined {
  if (!isRecord(value)) return undefined
  const primitive = firstString(value.primitive)
  const operation = firstString(value.operation, value.op, value.action)
  const hasWorkspaceShape =
    primitive === 'workspace.operation' ||
    typeof value.workspaceId === 'string' ||
    typeof value.path === 'string' ||
    firstString(value.kind)?.startsWith('workspace.') === true
  if (!operation || !hasWorkspaceShape) return undefined
  const path = firstString(value.path, value.filePath)
  const status = firstString(value.status)
  const resultKind = firstString(value.resultKind, value.kind)
  return Object.freeze({
    operation: normalizeOperationName(operation),
    ...(path ? { path } : {}),
    ...(status ? { status } : {}),
    ...(resultKind ? { resultKind } : {}),
  })
}

function workspaceOperationMatches(
  operation: QualityWorkspaceExecution,
  expected: ExpectedWorkspaceOperation,
): boolean {
  if (expected.operation && operation.operation !== normalizeOperationName(expected.operation)) return false
  if (expected.path && operation.path !== expected.path) return false
  if (expected.status && operation.status !== expected.status) return false
  if (expected.resultKind && operation.resultKind !== expected.resultKind) return false
  return true
}

function dedupeWorkspaceOperations(
  operations: readonly QualityWorkspaceExecution[],
): readonly QualityWorkspaceExecution[] {
  const seen = new Set<string>()
  const deduped: QualityWorkspaceExecution[] = []
  for (const operation of operations) {
    const key = stableJson(toJsonValue(operation))
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(operation)
  }
  return Object.freeze(deduped)
}

function extractRoutingReports(output: unknown): readonly QualityRoutingExecution[] {
  const reports: QualityRoutingExecution[] = []
  visitRecords(output, (record) => {
    for (const key of ['routing', 'routingReports']) {
      const value = record[key]
      const direct = Array.isArray(value) ? value : [value]
      for (const item of direct) {
        const report = normalizeRoutingReport(item)
        if (report) reports.push(report)
      }
    }
    const metaRouting = objectRecord(objectRecord(record._meta)?.routing)
    const metaReport = normalizeRoutingReport(metaRouting)
    if (metaReport) reports.push(metaReport)
    const report = normalizeRoutingReport(record)
    if (report) reports.push(report)
  })
  return Object.freeze(dedupeRoutingReports(reports))
}

function normalizeRoutingReport(value: unknown): QualityRoutingExecution | undefined {
  if (!isRecord(value)) return undefined
  const kind = firstString(value.kind)
  const routingKind = firstString(value.routingKind, value.type)
  const hasRoutingShape =
    kind === 'routing.report' ||
    routingKind === 'router' ||
    routingKind === 'cascade' ||
    routingKind === 'fallback' ||
    'selectedModel' in value ||
    'classifiedAs' in value ||
    'chosen' in value
  if (!hasRoutingShape) return undefined
  const chosen = firstString(value.chosen, value.route, value.selectedRoute)
  const classifiedAs = firstString(value.classifiedAs, value.classification)
  const selectedModel = firstString(value.selectedModel, value.model, value.modelId)
  const fallbackReason = firstString(value.fallbackReason)
  const tiers = Array.isArray(value.tiers)
    ? value.tiers.map(normalizeRoutingTier).filter((tier): tier is QualityRoutingTierExecution => tier !== undefined)
    : []
  return Object.freeze({
    ...(routingKind ? { routingKind } : {}),
    ...(chosen ? { chosen } : {}),
    ...(classifiedAs ? { classifiedAs } : {}),
    ...(selectedModel ? { selectedModel } : {}),
    ...(fallbackReason ? { fallbackReason } : {}),
    tiers: Object.freeze(tiers),
  })
}

function normalizeRoutingTier(value: unknown): QualityRoutingTierExecution | undefined {
  if (!isRecord(value)) return undefined
  const tier = typeof value.tier === 'number' && Number.isFinite(value.tier) ? value.tier : undefined
  const model = firstString(value.model, value.modelId)
  const verdict = firstString(value.verdict, value.status)
  const confidence =
    typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? value.confidence : undefined
  if (tier === undefined && !model && !verdict && confidence === undefined) return undefined
  return Object.freeze({
    ...(tier !== undefined ? { tier } : {}),
    ...(model ? { model } : {}),
    ...(verdict ? { verdict } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  })
}

function dedupeRoutingReports(reports: readonly QualityRoutingExecution[]): readonly QualityRoutingExecution[] {
  const seen = new Set<string>()
  const deduped: QualityRoutingExecution[] = []
  for (const report of reports) {
    const key = stableJson(toJsonValue(report))
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(report)
  }
  return Object.freeze(deduped)
}

function normalizeOperationName(value: string): string {
  return value.toLowerCase()
}

function extractHandoffs(output: unknown): readonly QualityHandoffExecution[] {
  const handoffs: QualityHandoffExecution[] = []
  visitRecords(output, (record) => {
    for (const key of ['handoffs', 'handoffEvents']) {
      const value = record[key]
      if (Array.isArray(value)) {
        for (const item of value) {
          const handoff = normalizeHandoff(item)
          if (handoff) handoffs.push(handoff)
        }
      }
    }

    const path = stringArray(record.handoffPath)
    const hasExplicitHandoffList = Array.isArray(record.handoffs) || Array.isArray(record.handoffEvents)
    if (!hasExplicitHandoffList && path && path.length > 1) {
      for (let index = 0; index < path.length - 1; index += 1) {
        const fromAgent = path[index]
        const toAgent = path[index + 1]
        if (!fromAgent || !toAgent) continue
        handoffs.push(
          Object.freeze({
            fromAgent,
            toAgent,
            hopNumber: index + 1,
          }),
        )
      }
    }

    const direct = normalizeHandoff(record)
    if (direct) handoffs.push(direct)
  })
  return Object.freeze(dedupeHandoffs(handoffs))
}

function normalizeHandoff(value: unknown): QualityHandoffExecution | undefined {
  if (!isRecord(value)) return undefined
  const id = firstString(value.id, value.handoffId)
  const fromAgent = firstString(value.fromAgent, value.from)
  const toAgent = firstString(value.toAgent, value.to)
  const reason = firstString(value.reason)
  const context = firstString(value.context)
  const hopNumber = typeof value.hopNumber === 'number' ? value.hopNumber : undefined
  const data = value.data
  const summary = firstString(value.summary)
  if (!id && !fromAgent && !toAgent) return undefined
  return Object.freeze({
    ...(id ? { id } : {}),
    ...(fromAgent ? { fromAgent } : {}),
    ...(toAgent ? { toAgent } : {}),
    ...(reason ? { reason } : {}),
    ...(context ? { context } : {}),
    ...(hopNumber !== undefined ? { hopNumber } : {}),
    ...(data !== undefined ? { data } : {}),
    ...(summary ? { summary } : {}),
  })
}

function extractHandoffPath(output: unknown): readonly string[] {
  const record = objectRecord(output)
  const directPath = stringArray(record?.handoffPath)
  if (directPath) return Object.freeze(directPath)
  const handoffs = extractHandoffs(output)
  const ordered = [...handoffs]
    .filter((handoff) => handoff.fromAgent && handoff.toAgent)
    .sort((left, right) => (left.hopNumber ?? Number.MAX_SAFE_INTEGER) - (right.hopNumber ?? Number.MAX_SAFE_INTEGER))
  if (ordered.length === 0) return Object.freeze([])
  const [first] = ordered
  const path = first.fromAgent ? [first.fromAgent] : []
  for (const handoff of ordered) {
    if (handoff.toAgent) path.push(handoff.toAgent)
  }
  return Object.freeze(path)
}

function dedupeHandoffs(handoffs: readonly QualityHandoffExecution[]): readonly QualityHandoffExecution[] {
  const seen = new Set<string>()
  const deduped: QualityHandoffExecution[] = []
  for (const handoff of handoffs) {
    const hasIdentity = Boolean(handoff.id || handoff.fromAgent || handoff.toAgent) || handoff.hopNumber !== undefined
    const key = hasIdentity
      ? `${handoff.id ?? ''}:${handoff.fromAgent ?? ''}:${handoff.toAgent ?? ''}:${handoff.hopNumber ?? ''}`
      : stableJson(toJsonValue(handoff))
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(handoff)
  }
  return Object.freeze(deduped)
}

function handoffMatches(handoff: QualityHandoffExecution, expected: ExpectedHandoff): boolean {
  if (expected.id && handoff.id !== expected.id) return false
  if (expected.fromAgent && handoff.fromAgent !== expected.fromAgent) return false
  if (expected.toAgent && handoff.toAgent !== expected.toAgent) return false
  if (expected.reason && handoff.reason !== expected.reason) return false
  if (expected.hopNumber !== undefined && handoff.hopNumber !== expected.hopNumber) return false
  return true
}

function firstString(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined
  return Object.freeze([...value])
}

function dedupeRecords(records: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  const seen = new Set<string>()
  const deduped: Record<string, unknown>[] = []
  for (const record of records) {
    const key = stableJson(toJsonValue(record))
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(record)
  }
  return Object.freeze(deduped)
}

function visitRecords(
  value: unknown,
  visit: (record: Record<string, unknown>) => void,
  seen = new WeakSet<object>(),
): void {
  if (!value || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) visitRecords(item, visit, seen)
    return
  }
  const record = value as Record<string, unknown>
  visit(record)
  for (const nested of Object.values(record)) visitRecords(nested, visit, seen)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function assertContains(label: string, actual: JsonValue, expected: JsonValue): void {
  if (typeof expected === 'string') {
    const text = stringifyForAssertion(actual)
    if (!text.includes(expected)) throw new Error(`Expected output to contain "${expected}" for ${label}.`)
    return
  }
  if (Array.isArray(expected) && expected.every((item) => typeof item === 'string')) {
    for (const item of expected) assertContains(label, actual, item)
    return
  }
  throw new Error(`${label} must be a string or array of strings.`)
}

function assertExpectedField(field: string, actual: JsonValue, expected: JsonValue): void {
  if (typeof expected === 'string' && typeof actual === 'string') {
    if (!actual.includes(expected)) {
      throw new Error(`Expected output.${field} to contain "${expected}".`)
    }
    return
  }
  assertJsonEqual(`expected.${field}`, actual, expected)
}

function assertJsonEqual(label: string, actual: JsonValue, expected: JsonValue): void {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(`Expected ${label} to equal ${stableJson(expected)}.`)
  }
}

function stringifyForAssertion(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stableJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function hashJson(value: JsonValue): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function toJsonValue(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (value === null) return null
  const valueType = typeof value
  if (valueType === 'string' || valueType === 'boolean') return value as string | boolean
  if (valueType === 'number') return Number.isFinite(value as number) ? (value as number) : null
  if (valueType === 'bigint' || valueType === 'symbol' || valueType === 'function' || valueType === 'undefined') {
    return null
  }
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item, seen))
  if (value && valueType === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const out: Record<string, JsonValue> = {}
    for (const [key, nested] of Object.entries(value)) out[key] = toJsonValue(nested, seen)
    seen.delete(value)
    return out
  }
  return String(value)
}

function toJsonRecord(value: Record<string, unknown>, label: string): JsonRecord {
  const json = toJsonValue(value)
  if (!isJsonObject(json)) throw new Error(`${label} must serialize to a JSON object.`)
  return json
}

function isPortableSuiteJson(value: unknown): value is PortableSuiteJson {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { id?: unknown; cases?: unknown }
  return typeof candidate.id === 'string' && Array.isArray(candidate.cases)
}

function isExperimentRecord(value: unknown): value is ExperimentRecord {
  return Boolean(value && typeof value === 'object' && (value as { _tag?: unknown })._tag === 'Experiment')
}

function isQualityComparisonRecord(value: unknown): value is QualityComparisonRecord {
  return Boolean(value && typeof value === 'object' && (value as { _tag?: unknown })._tag === 'QualityComparison')
}

function isQualityBaselineRecord(value: unknown): value is QualityBaselineRecord {
  return Boolean(value && typeof value === 'object' && (value as { _tag?: unknown })._tag === 'QualityBaseline')
}

function isQualityFeedbackRecord(value: unknown): value is QualityFeedbackRecord {
  return Boolean(value && typeof value === 'object' && (value as { _tag?: unknown })._tag === 'QualityFeedback')
}

function isQualityFeedbackAnnotationRecord(value: unknown): value is QualityFeedbackAnnotationRecord {
  return Boolean(
    value && typeof value === 'object' && (value as { _tag?: unknown })._tag === 'QualityFeedbackAnnotation',
  )
}

function isQualityFeedbackMemoryProposalRecord(value: unknown): value is QualityFeedbackMemoryProposalRecord {
  return Boolean(
    value && typeof value === 'object' && (value as { _tag?: unknown })._tag === 'QualityFeedbackMemoryProposal',
  )
}

function isCassetteFile(value: unknown): value is CassetteFile {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { _tag?: unknown; version?: unknown; entries?: unknown }
  return candidate._tag === 'Cassette' && candidate.version === 1 && Array.isArray(candidate.entries)
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === code)
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function safeFileName(value: string): string {
  const safe = slugify(value)
  if (!safe) throw new Error(`Invalid file name for id "${value}".`)
  return safe
}
