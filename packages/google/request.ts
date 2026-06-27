import type { Content, GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import type { GenerationSettings } from '@crux/core'
import type { CallArgs } from '@crux/core/adapter'
import type { NativeChatRequestArgs } from '@crux/core/adapter/native-chat'
import type { GoogleCachedContentLifecycle } from './cached-content'
import type { GoogleExtra, GoogleRequest } from './types'

/** Build the native Google generation request from canonical Crux args. */
export async function googleRequest(
  args: NativeChatRequestArgs<GoogleExtra, Content>,
  cachedContent: GoogleCachedContentLifecycle,
): Promise<GoogleRequest> {
  const systemPlan = await cachedContent.prepare({
    model: args.model,
    system: args.system,
    systemBlocks: args.systemBlocks,
    call: args.extra?.cachedContent,
  })

  const config: Record<string, unknown> = { ...args.settings, ...systemPlan.config }

  const toolsConfig = googleToolsConfig(args)
  if (toolsConfig) Object.assign(config, toolsConfig)
  if (args.schemaParams) Object.assign(config, args.schemaParams)

  return {
    model: args.model,
    contents: [...args.providerMessages],
    config,
  }
}

/** Map canonical generation settings to Google-native request fields. */
export function googleSettings(settings: GenerationSettings): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  if (settings.temperature !== undefined) config.temperature = settings.temperature
  if (settings.maxTokens !== undefined) config.maxOutputTokens = settings.maxTokens
  if (settings.topP !== undefined) config.topP = settings.topP
  if (settings.topK !== undefined) config.topK = settings.topK
  if (settings.stopSequences !== undefined) config.stopSequences = settings.stopSequences

  const knownKeys = new Set([
    'temperature',
    'maxTokens',
    'topP',
    'topK',
    'stopSequences',
    'frequencyPenalty',
    'presencePenalty',
  ])
  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined && !knownKeys.has(key) && !(key in config)) {
      config[key] = value
    }
  }

  return config
}

/** Convert a Zod schema into Google structured JSON-output params. */
export function googleOutputSchema(schema: z.ZodType): Record<string, unknown> {
  return {
    responseMimeType: 'application/json',
    responseJsonSchema: z.toJSONSchema(schema) as Record<string, unknown>,
  }
}

/** Narrow a generated request to Google `generateContent()` parameters. */
export function asGoogleGenerateContentParams(
  request: GoogleRequest,
): Parameters<GoogleGenAI['models']['generateContent']>[0] {
  return request as unknown as Parameters<GoogleGenAI['models']['generateContent']>[0]
}

/** Narrow a generated request to Google `generateContentStream()` parameters. */
export function asGoogleGenerateContentStreamParams(
  request: GoogleRequest,
): Parameters<GoogleGenAI['models']['generateContentStream']>[0] {
  return request as unknown as Parameters<GoogleGenAI['models']['generateContentStream']>[0]
}

function googleToolsConfig(args: CallArgs<GoogleExtra>): Record<string, unknown> | undefined {
  if (args.extra?.tools && args.extra.tools.length > 0) {
    return { tools: [{ functionDeclarations: args.extra.tools }] }
  }
  if (args.tools && args.tools.length > 0) {
    return {
      tools: [
        {
          functionDeclarations: args.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            ...(Object.keys(tool.parameters).length > 0 ? { parameters: tool.parameters } : {}),
          })),
        },
      ],
    }
  }
  return undefined
}
