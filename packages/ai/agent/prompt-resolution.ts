import type { z } from 'zod'
import type { ContextEntry, Prompt } from '@crux/core'
import type { SkillActivationSession } from '@crux/core/skill'
import { getRuntime } from '@crux/core'
import { captureSource } from '@crux/core/project-index'
import type { AgentResolveOptions, AgentResolveResult } from './types'

function readTraceId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !('traceId' in result)) return undefined
  const traceId = (result as { traceId?: unknown }).traceId
  return typeof traceId === 'string' ? traceId : undefined
}

function readSkillSession(result: unknown): SkillActivationSession | undefined {
  if (!result || typeof result !== 'object' || !('_skillSession' in result)) return undefined
  const session = (result as { _skillSession?: unknown })._skillSession
  if (!session || typeof session !== 'object') return undefined
  return session as SkillActivationSession
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
    skillSession: readSkillSession(resolved),
  }
}
