/**
 * Shared canonical options fixture for future adapter parity tests.
 */

import { hasToolCall } from '../../generation'
import type { Message } from '../../generation/messages'
import type { StopCondition, ToolChoice } from '../../generation/tool-control'
import type { ValidationRetryOptions } from '../../generation/validation-retry'

type ToolApprovalPolicy = 'always' | 'never'

export interface CanonicalOptionsFixture {
  readonly model: string
  readonly input: Record<string, unknown>
  readonly messages: readonly Message[]
  readonly tools: Record<string, unknown>
  readonly toolMiddleware: readonly unknown[]
  readonly toolApproval: Readonly<Record<string, ToolApprovalPolicy>>
  readonly toolsContext: Readonly<Record<string, unknown>>
  readonly runtimeContext: Readonly<Record<string, unknown>>
  readonly activeTools: readonly string[]
  readonly timeout: {
    readonly totalMs: number
    readonly stepMs: number
    readonly chunkMs: number
    readonly toolMs: number
    readonly tools: Readonly<Record<string, number>>
  }
  readonly tokenBudget: number
  readonly validationRetry: ValidationRetryOptions
  readonly constraints: readonly unknown[]
  readonly constraintMaxRetries: number
  readonly guardrails: readonly unknown[]
  readonly abortSignal: AbortSignal
  readonly transport: (
    params: unknown,
    info: { readonly stepIndex: number; readonly modelId: string; readonly signal: AbortSignal },
  ) => Promise<unknown>
  readonly extra: Record<string, unknown>
  readonly temperature: number
  readonly maxTokens: number
  readonly topP: number
  readonly topK: number
  readonly stopSequences: readonly string[]
  readonly seed: number
  readonly reasoning: 'low' | 'medium' | 'high'
  readonly toolChoice: ToolChoice
  readonly stopWhen: StopCondition | readonly StopCondition[]
  readonly maxSteps: number
  readonly frequencyPenalty: number
  readonly presencePenalty: number
}

export interface CanonicalOptionsParityCase {
  readonly phase: 2 | 3 | 5 | 6 | 7 | 9
  readonly name: string
}

export const CANONICAL_OPTIONS_PARITY_CASES = [
  { phase: 2, name: 'all adapters map canonical reasoning with the same call-site field' },
  { phase: 3, name: 'all adapters accept structured timeout and reject timeoutMs' },
  { phase: 5, name: '@use-crux/ai rejects SDK call settings outside extra' },
  { phase: 6, name: 'toolApproval is resolved from the canonical call option' },
  { phase: 7, name: 'toolsContext is conditionally required from composed tool schemas' },
  { phase: 9, name: 'transport receives provider params derived from the same canonical options' },
] as const satisfies readonly CanonicalOptionsParityCase[]

/** Create the canonical options object every adapter parity suite should share. */
export function createCanonicalOptionsFixture(
  overrides: Partial<CanonicalOptionsFixture> = {},
): CanonicalOptionsFixture {
  const controller = new AbortController()

  return {
    model: 'fixture-model',
    input: { instruction: 'Run the canonical options parity fixture.' },
    messages: [{ role: 'user', content: 'Previous turn.' }],
    tools: {
      search: {
        description: 'Search fixture data.',
        execute: async (args: unknown) => ({ args }),
      },
    },
    toolMiddleware: [],
    toolApproval: { search: 'always', '*': 'never' },
    toolsContext: { search: { tenantId: 'tenant_1' } },
    runtimeContext: { requestId: 'req_1' },
    activeTools: ['search'],
    timeout: {
      totalMs: 30_000,
      stepMs: 10_000,
      chunkMs: 2_000,
      toolMs: 5_000,
      tools: { search: 1_000 },
    },
    tokenBudget: 4_096,
    validationRetry: { maxRetries: 1 },
    constraints: [],
    constraintMaxRetries: 1,
    guardrails: [],
    abortSignal: controller.signal,
    transport: async (params, info) => ({ params, info }),
    extra: { providerRequestId: 'provider_req_1' },
    temperature: 0.2,
    maxTokens: 256,
    topP: 0.9,
    topK: 40,
    stopSequences: ['END'],
    seed: 123,
    reasoning: 'medium',
    toolChoice: 'auto',
    stopWhen: [hasToolCall('search')],
    maxSteps: 3,
    frequencyPenalty: 0.1,
    presencePenalty: 0.2,
    ...overrides,
  }
}

