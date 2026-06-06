import { expectTypeOf } from 'vitest'
import {
  expect,
  qualityMatcherRegistry,
  type QualityAssertionFailure,
  type QualityAssertionResult,
  type QualityArtifactExecution,
  type QualityBudgetMatchers,
  type QualityCacheExecution,
  type QualityCitationExecution,
  type QualityContextExecution,
  type QualityEmbeddingExecution,
  type QualityErrorExecution,
  type QualityEventExecution,
  type QualityExpectationContext,
  type QualityExpectApi,
  type QualityGroundingMatchers,
  type QualityLatencyExecution,
  type QualityMatcherNamespace,
  type QualityOutputMatchers,
  type QualityConfig,
  type QualityRetrievalExecution,
  type QualitySafetyExecution,
  type QualitySpanExecution,
  type QualityStepExecution,
  type QualityStructuredOutputMatchers,
  type QualityToolCallExecution,
  type QualityToolResultMatchers,
  type QualityUsageMatchers,
  type QualityWorkspaceExecution,
} from '@crux/core/quality'

expectTypeOf(expect).toEqualTypeOf<QualityExpectApi>()
expectTypeOf<keyof typeof qualityMatcherRegistry>().toEqualTypeOf<QualityMatcherNamespace>()

const qualityDiscoveryConfig = {
  id: 'support',
  dir: '.crux/quality',
  include: ['evals/**/*.suite.ts'],
  cassetteInclude: 'evals/cassettes/**/*.cassette.json',
  exclude: ['evals/tmp/**'],
} as const satisfies QualityConfig

expectTypeOf(qualityDiscoveryConfig.include).toEqualTypeOf<readonly ['evals/**/*.suite.ts']>()
expectTypeOf(qualityDiscoveryConfig.cassetteInclude).toEqualTypeOf<'evals/cassettes/**/*.cassette.json'>()

declare const ctx: QualityExpectationContext<{ question: string }, { answer: string }>
expectTypeOf(ctx.output.answer).toEqualTypeOf<string>()
expectTypeOf(ctx.retrieval).toEqualTypeOf<QualityRetrievalExecution>()
expectTypeOf(ctx.toolCalls).toEqualTypeOf<readonly QualityToolCallExecution[]>()
expectTypeOf(ctx.toolCalls[0]?.status).toEqualTypeOf<string | undefined>()
expectTypeOf(ctx.toolCalls[0]?.error).toEqualTypeOf<unknown>()
expectTypeOf(ctx.steps).toEqualTypeOf<readonly QualityStepExecution[]>()
expectTypeOf(ctx.citations).toEqualTypeOf<readonly QualityCitationExecution[]>()
expectTypeOf(ctx.artifacts).toEqualTypeOf<readonly QualityArtifactExecution[]>()
expectTypeOf(ctx.safety).toEqualTypeOf<QualitySafetyExecution>()
expectTypeOf(ctx.workspace).toEqualTypeOf<readonly QualityWorkspaceExecution[]>()
expectTypeOf(ctx.cache).toEqualTypeOf<readonly QualityCacheExecution[]>()
expectTypeOf(ctx.embeddings).toEqualTypeOf<readonly QualityEmbeddingExecution[]>()
expectTypeOf(ctx.errors).toEqualTypeOf<readonly QualityErrorExecution[]>()
expectTypeOf(ctx.latency).toEqualTypeOf<readonly QualityLatencyExecution[]>()
expectTypeOf(ctx.events).toEqualTypeOf<readonly QualityEventExecution[]>()
expectTypeOf(ctx.spans).toEqualTypeOf<readonly QualitySpanExecution[]>()
expectTypeOf(ctx.contexts).toEqualTypeOf<readonly QualityContextExecution[]>()

declare const outputMatchers: QualityOutputMatchers
declare const structuredOutputMatchers: QualityStructuredOutputMatchers
declare const toolResultMatchers: QualityToolResultMatchers
declare const groundingMatchers: QualityGroundingMatchers
declare const usageMatchers: QualityUsageMatchers
declare const budgetMatchers: QualityBudgetMatchers

outputMatchers.toSatisfyField('confidence', (value) => typeof value === 'number')
structuredOutputMatchers.toMatchSchema({ safeParse: () => ({ success: true }) })
toolResultMatchers.toSatisfyToolResult('searchDocs', (result) => Boolean(result))
groundingMatchers.toHaveCitationForSource('refunds.md')
usageMatchers.toHaveTokenUsageBelow(2_000)
budgetMatchers.toHaveLatencyBelow(1_000)

expectTypeOf<Pick<QualityAssertionFailure, 'source' | 'message'>>().toEqualTypeOf<{
  readonly source: 'expected' | 'expect'
  readonly message: string
}>()
expectTypeOf<QualityAssertionResult>().toEqualTypeOf<
  | { readonly passed: true }
  | {
      readonly passed: false
      readonly error: string
      readonly failures: readonly QualityAssertionFailure[]
    }
>()
