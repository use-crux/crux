import type OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import type { z } from 'zod'
import type { CallArgs } from '@crux/core/adapter'
import type { NativeChatRequestArgs } from '@crux/core/adapter'
import type { GenerationSettings } from '@crux/core'
import type { OpenAIChatRequest, OpenAIExtra } from './types'

/** Build the OpenAI chat-completion request body from canonical Crux args. */
export function openAIRequest(
  args: NativeChatRequestArgs<OpenAIExtra, OpenAI.ChatCompletionMessageParam>,
): OpenAIChatRequest {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    ...(args.system ? [{ role: 'system' as const, content: args.system }] : []),
    ...args.providerMessages,
  ]

  return {
    model: args.model,
    messages,
    ...args.settings,
    ...openAIToolParams(args),
    ...(args.schemaParams ?? {}),
  }
}

/** Add OpenAI's streaming flag to an already assembled request body. */
export function openAIStreamRequest(request: OpenAIChatRequest): OpenAIChatRequest {
  return { ...request, stream: true }
}

/** Map canonical generation settings onto OpenAI chat-completion fields. */
export function openAISettings(settings: GenerationSettings): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (settings.temperature !== undefined) result.temperature = settings.temperature
  if (settings.maxTokens !== undefined) result.max_tokens = settings.maxTokens
  if (settings.topP !== undefined) result.top_p = settings.topP
  if (settings.frequencyPenalty !== undefined) result.frequency_penalty = settings.frequencyPenalty
  if (settings.presencePenalty !== undefined) result.presence_penalty = settings.presencePenalty
  if (settings.stopSequences !== undefined) result.stop = settings.stopSequences

  const knownKeys = new Set([
    'temperature',
    'maxTokens',
    'topP',
    'topK',
    'frequencyPenalty',
    'presencePenalty',
    'stopSequences',
  ])
  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined && !knownKeys.has(key) && !(key in result)) {
      result[key] = value
    }
  }

  return result
}

/** Convert a Zod schema into OpenAI's structured-output response format. */
export function openAIOutputSchema(schema: z.ZodType): Record<string, unknown> {
  return {
    // OpenAI's helper ships with its own bundled Zod typings. Cross-version
    // `z.ZodType` shapes do not structurally align, so widen at this boundary.
    response_format: zodResponseFormat(schema as Parameters<typeof zodResponseFormat>[0], 'output'),
  }
}

/** Narrow OpenAI request body for non-streaming create/parse SDK calls. */
export function asOpenAINonStreamingParams(request: OpenAIChatRequest): OpenAI.ChatCompletionCreateParamsNonStreaming {
  return request as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming
}

/** Narrow OpenAI request body for streaming create SDK calls. */
export function asOpenAIStreamingParams(request: OpenAIChatRequest): OpenAI.ChatCompletionCreateParamsStreaming {
  return request as unknown as OpenAI.ChatCompletionCreateParamsStreaming
}

function openAIToolParams(args: CallArgs<OpenAIExtra>): Record<string, unknown> {
  const toolParams: Record<string, unknown> = {}
  if (args.extra?.tools && args.extra.tools.length > 0) {
    toolParams.tools = args.extra.tools
  } else if (args.tools && args.tools.length > 0) {
    toolParams.tools = args.tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        ...(Object.keys(tool.parameters).length > 0 ? { parameters: tool.parameters } : {}),
      },
    }))
  }

  if (args.extra?.tool_choice) {
    toolParams.tool_choice = args.extra.tool_choice
  }
  if (args.extra?.parallel_tool_calls !== undefined) {
    toolParams.parallel_tool_calls = args.extra.parallel_tool_calls
  }

  return toolParams
}
