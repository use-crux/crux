/**
 * `@use-crux/ai/agent` — Vercel AI SDK bridge for external agent frameworks.
 *
 * Resolves Crux prompts into instructions and returns an AI SDK language model
 * suitable for frameworks such as `@convex-dev/agent` or Mastra. When Crux
 * execution hooks are installed, the returned model is wrapped with tracing
 * middleware that reports generate/stream usage, cost, tool-call timing, and
 * stream progress.
 *
 * @example
 * ```ts
 * import { resolve } from '@use-crux/ai/agent'
 *
 * const { instructions, model } = await resolve(agentPrompt, {
 *   model: languageModel,
 *   input: { mode: 'draft' },
 *   tools: Object.keys(tools),
 * })
 * ```
 *
 * @module
 */

import { wrapLanguageModel } from 'ai'
import type { z } from 'zod'
import type { ContextEntry, Prompt } from '@use-crux/core'
import { getHooks } from '@use-crux/core'
import { resolveAgentInstructions } from './prompt-resolution'
import { createTracingMiddleware } from './tracing-middleware'
import type { AgentResolveOptions, AgentResolveResult } from './types'

export type { AgentResolveOptions, AgentResolveResult } from './types'

/**
 * Resolve a Crux prompt for an AI SDK-based external agent framework.
 *
 * Runs normal Crux prompt resolution, then adds the AI SDK runtime binding:
 * when an execution hook is installed, it wraps the model with AI SDK
 * middleware that reports Crux traces.
 */
export async function resolve<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
>(
  prompt: Prompt<TOwnInput, TOutput, TContexts>,
  opts: AgentResolveOptions<TOwnInput, TContexts>,
): Promise<AgentResolveResult> {
  const resolved = await resolveAgentInstructions(prompt, opts)
  const executionHook = getHooks().executionHook
  const model = executionHook
    ? wrapLanguageModel({
        model: resolved.model,
        middleware: createTracingMiddleware(
          prompt.id,
          executionHook,
          resolved.resolveTraceId,
          resolved.inspect,
          resolved.skillSession,
        ),
      })
    : resolved.model

  return { ...resolved, model }
}
