import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { z } from 'zod'
import type { ContextEntry, InspectResult, MergedInput } from '@crux/core'

/**
 * Options for resolving a Crux prompt for an AI SDK-based agent framework.
 *
 * The model is a Vercel AI SDK language model. When Crux execution hooks are
 * installed, `@crux/ai/agent` returns a wrapped model that reports generate
 * and stream traces while preserving the agent framework's own execution loop.
 */
export type AgentResolveOptions<TOwnInput extends z.ZodType, TContexts extends readonly ContextEntry[]> = {
  /** The AI SDK language model instance returned to the agent framework. */
  model: LanguageModelV3
  /** Optional token budget for system message composition. */
  tokenBudget?: number
  /**
   * Tool names registered with the agent framework.
   *
   * These names are merged into inspect metadata so observability surfaces can
   * show both prompt/context tools and tools supplied directly to the agent.
   */
  tools?: readonly string[]
} & ([keyof MergedInput<TOwnInput, TContexts>] extends [never]
  ? { input?: undefined }
  : { input: MergedInput<TOwnInput, TContexts> })

/**
 * Resolved instructions and AI SDK model for an external agent framework.
 *
 * `inspect` and `resolveTraceId` are exposed for advanced integrations and
 * tests; most callers pass only `instructions` and `model` to their framework.
 */
export interface AgentResolveResult {
  /** Fully composed system instructions for the agent framework. */
  instructions: string
  /** AI SDK language model, wrapped when Crux execution hooks are installed. */
  model: LanguageModelV3
  /** Prompt inspection data after framework tool names have been merged. */
  inspect: InspectResult
  /** Trace id returned by the runtime resolve hook, when one is installed. */
  resolveTraceId?: string
}
