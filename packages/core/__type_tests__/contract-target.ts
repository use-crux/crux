/**
 * Target compile-time contract for the pre-launch adapter API.
 *
 * This file intentionally describes the future public surface without
 * importing every live implementation type yet. Later phases replace the
 * phase-local target declarations with real imports as each contract lands.
 */

import type { ApprovalRequestInfo } from '../adapter/tool/approval'
import type { Message } from '../generation/messages'
import type { StopCondition, ToolChoice } from '../generation/tool-control'
import type { TraceMeta } from '../generation/types'

type AssertEqual<T, U> = (<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2
  ? (<G>() => G extends U ? 1 : 2) extends <G>() => G extends T ? 1 : 2
    ? true
    : false
  : false

type Expect<T extends true> = T

type RequiredKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? never : K
}[keyof T]

type OptionalKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? K : never
}[keyof T]

// Phase 2 replaces this with the real TokenUsage import.
interface TargetTokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  inputTokenDetails: {
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  outputTokenDetails: {
    reasoningTokens?: number
  }
}

type _TokenUsageRequiredKeys = Expect<
  AssertEqual<
    RequiredKeys<TargetTokenUsage>,
    'inputTokens' | 'outputTokens' | 'totalTokens' | 'inputTokenDetails' | 'outputTokenDetails'
  >
>
type _TokenUsageOptionalKeys = Expect<AssertEqual<OptionalKeys<TargetTokenUsage>, never>>
type _TokenUsageInputDetails = Expect<
  AssertEqual<
    TargetTokenUsage['inputTokenDetails'],
    {
      cacheReadTokens?: number
      cacheWriteTokens?: number
    }
  >
>
type _TokenUsageOutputDetails = Expect<
  AssertEqual<
    TargetTokenUsage['outputTokenDetails'],
    {
      reasoningTokens?: number
    }
  >
>

// Phase 3 replaces these with the real timeout exports.
type TargetTimeoutBudget = 'total' | 'step' | 'chunk' | 'tool'

interface TargetTimeoutOptions {
  totalMs?: number
  stepMs?: number
  chunkMs?: number
  toolMs?: number
  tools?: Readonly<Record<string, number>>
}

interface TargetTimeoutError extends Error {
  readonly budget: TargetTimeoutBudget
  readonly limitMs: number
  readonly toolName?: string
}

type _TimeoutOptionsKeys = Expect<
  AssertEqual<keyof TargetTimeoutOptions, 'totalMs' | 'stepMs' | 'chunkMs' | 'toolMs' | 'tools'>
>
type _TimeoutToolsReadonly = Expect<
  AssertEqual<TargetTimeoutOptions['tools'], Readonly<Record<string, number>> | undefined>
>
type _TimeoutErrorBudget = Expect<AssertEqual<TargetTimeoutError['budget'], TargetTimeoutBudget>>
type _TimeoutErrorLimit = Expect<AssertEqual<TargetTimeoutError['limitMs'], number>>
type _TimeoutErrorToolName = Expect<AssertEqual<TargetTimeoutError['toolName'], string | undefined>>

// Phases 2 and 5 replace this target with the real GenerationSettings import.
interface TargetGenerationSettings {
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  stopSequences?: readonly string[]
  seed?: number
  reasoning?: 'low' | 'medium' | 'high'
  toolChoice?: ToolChoice
  stopWhen?: StopCondition | readonly StopCondition[]
  maxSteps?: number
  frequencyPenalty?: number
  presencePenalty?: number
}

type _GenerationSettingsKeys = Expect<
  AssertEqual<
    keyof TargetGenerationSettings,
    | 'temperature'
    | 'maxTokens'
    | 'topP'
    | 'topK'
    | 'stopSequences'
    | 'seed'
    | 'reasoning'
    | 'toolChoice'
    | 'stopWhen'
    | 'maxSteps'
    | 'frequencyPenalty'
    | 'presencePenalty'
  >
>
type _ReasoningSetting = Expect<AssertEqual<TargetGenerationSettings['reasoning'], 'low' | 'medium' | 'high' | undefined>>
type _SeedSetting = Expect<AssertEqual<TargetGenerationSettings['seed'], number | undefined>>
type _StopSequencesSetting = Expect<AssertEqual<TargetGenerationSettings['stopSequences'], readonly string[] | undefined>>

// Phase 4 replaces these envelope targets with real GenerateResult exports.
interface TargetFinalStepInfo {
  text: string
  usage: TargetTokenUsage
  finishReason: string | undefined
  responseId: string | undefined
  modelId: string | undefined
}

interface TargetGenerateResult<TRaw, TOutput = unknown> {
  text: string
  object?: TOutput
  usage: TargetTokenUsage
  cost?: unknown
  steps: number
  finalStep: TargetFinalStepInfo
  messages: Message[]
  pendingApprovals?: readonly ApprovalRequestInfo[]
  raw: TRaw
  _meta: TraceMeta
}

interface TargetStreamCompletion<TOutput = unknown> {
  text: string
  object?: TOutput
  usage: TargetTokenUsage
  cost?: unknown
  steps: number
  finalStep: TargetFinalStepInfo
  messages: Message[]
  pendingApprovals?: readonly ApprovalRequestInfo[]
}

interface TargetStreamResult<TRawStream, TOutput = unknown> {
  textStream: AsyncIterable<string>
  raw: TRawStream
  completion: Promise<TargetStreamCompletion<TOutput>>
}

type _GenerateResultKeys = Expect<
  AssertEqual<
    keyof TargetGenerateResult<{ readonly provider: 'raw' }, { readonly ok: true }>,
    'text' | 'object' | 'usage' | 'cost' | 'steps' | 'finalStep' | 'messages' | 'pendingApprovals' | 'raw' | '_meta'
  >
>
type _GenerateResultRaw = Expect<
  AssertEqual<TargetGenerateResult<{ readonly provider: 'raw' }>['raw'], { readonly provider: 'raw' }>
>
type _GenerateResultObject = Expect<
  AssertEqual<TargetGenerateResult<unknown, { readonly ok: true }>['object'], { readonly ok: true } | undefined>
>
type _FinalStepUsage = Expect<AssertEqual<TargetGenerateResult<unknown>['finalStep']['usage'], TargetTokenUsage>>
type _StreamResultKeys = Expect<AssertEqual<keyof TargetStreamResult<{ readonly stream: true }>, 'textStream' | 'raw' | 'completion'>>
type _StreamRaw = Expect<AssertEqual<TargetStreamResult<{ readonly stream: true }>['raw'], { readonly stream: true }>>
type _StreamCompletion = Expect<
  AssertEqual<TargetStreamResult<unknown, { readonly ok: true }>['completion'], Promise<TargetStreamCompletion<{ readonly ok: true }>>>
>

