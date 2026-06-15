import type { LanguageModel } from 'ai'
import type { Message } from '@crux/core'
import type { ExecutorRequest } from '@crux/core/adapter'
import { buildSystemArg } from '../provider-profile'
import { toModelMessages } from '../messages'

/** Mutable SDK-argument bag used while planning a call. */
export type LoopArgs = Record<string, unknown>

/**
 * Build the shared AI SDK argument set for text, structured, and stream calls.
 *
 * The result intentionally stays structural: each AI SDK method has a wide
 * generic argument type, and the final plan narrows it to the selected gateway
 * method after mode-specific fields are attached.
 *
 * @internal
 */
export function buildBaseArgs(request: ExecutorRequest<LanguageModel>, options: { includeTools: boolean }): LoopArgs {
  const args: LoopArgs = {
    model: request.model,
    ...request.settings,
  }

  const systemArg = buildSystemArg(request.systemBlocks, request.system, request.modelInfo)
  if (systemArg !== undefined) args.system = systemArg

  if (request.messages && request.messages.length > 0) {
    args.messages = toModelMessages(request.messages)
  } else if (request.prompt) {
    args.prompt = request.prompt
  }

  if (options.includeTools) {
    if (request.tools && Object.keys(request.tools).length > 0) args.tools = request.tools
    if (request.activeTools && request.activeTools.length > 0) args.activeTools = [...request.activeTools]
    const toolChoice = request.extra?.toolChoice
    if (toolChoice !== undefined) args.toolChoice = toolChoice
  }

  if (request.abortSignal) args.abortSignal = request.abortSignal
  return args
}

/**
 * Recreate the canonical prompt/messages base that core expects in loop
 * outcomes before appending AI SDK response messages.
 *
 * @internal
 */
export function canonicalBase(request: ExecutorRequest<LanguageModel>): Message[] {
  if (request.messages && request.messages.length > 0) return [...request.messages]
  if (request.prompt) return [{ role: 'user', content: request.prompt }]
  return []
}
