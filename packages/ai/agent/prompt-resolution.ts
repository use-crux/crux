import type { z } from 'zod'
import type { ContextEntry, Prompt } from '@crux/core'
import { getRuntime } from '@crux/core'
import { captureSource } from '@crux/core/project-index'
import type { AgentResolveOptions, AgentResolveResult } from './types'

function readTraceId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !('traceId' in result)) return undefined
  const traceId = (result as { traceId?: unknown }).traceId
  return typeof traceId === 'string' ? traceId : undefined
}

/**
 * Resolve a Crux prompt into instructions for an AI SDK-based agent framework.
 *
 * This runs the normal prompt resolution and inspection pipeline, fires the
 * global resolve hook, and leaves model wrapping to `resolve()`.
 */
export async function resolveAgentInstructions<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
>(
  prompt: Prompt<TOwnInput, TOutput, TContexts>,
  opts: AgentResolveOptions<TOwnInput, TContexts>,
): Promise<AgentResolveResult> {
  const optsRecord = opts as AgentResolveOptions<TOwnInput, TContexts> & {
    input?: Record<string, unknown>
    tokenBudget?: number
    tools?: readonly string[]
  }
  const input = optsRecord.input ?? {}
  const resolveOpts = { input, tokenBudget: optsRecord.tokenBudget }

  const source = captureSource()
  type PromptResolveOpts = Parameters<typeof prompt.resolve>[0]
  const resolved = await prompt.resolve(resolveOpts as unknown as PromptResolveOpts)
  const inspect = await prompt.inspect(resolveOpts as unknown as PromptResolveOpts)

  if (optsRecord.tools && optsRecord.tools.length > 0) {
    const existing = inspect.tools ?? []
    inspect.tools = [...new Set([...existing, ...optsRecord.tools])]
  }

  const hookResult = await getRuntime().resolveHook?.({
    promptId: prompt.id,
    input,
    inspect,
    source,
  })

  return {
    instructions: resolved.system ?? '',
    model: opts.model,
    inspect,
    resolveTraceId: readTraceId(hookResult),
  }
}
