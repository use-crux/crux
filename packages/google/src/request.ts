import type { Content, GoogleGenAI } from '@google/genai'
import type { GenerationSettings } from '@use-crux/core'
import type { CallArgs } from '@use-crux/core/adapter'
import type {
  NativeChatRequestArgs,
  StructuredOutputCapabilities,
} from '@use-crux/core/adapter'
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
  if (args.outputSchema) {
    config.responseMimeType = 'application/json'
    config.responseJsonSchema = args.outputSchema
  }

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
  if (settings.seed !== undefined) config.seed = settings.seed
  if (settings.reasoning !== undefined) {
    config.thinkingConfig = { thinkingLevel: googleThinkingLevel(settings.reasoning) }
  }

  const knownKeys = new Set([
    'temperature',
    'maxTokens',
    'topP',
    'topK',
    'seed',
    'stopSequences',
    'frequencyPenalty',
    'presencePenalty',
    'reasoning',
  ])
  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined && !knownKeys.has(key) && !(key in config)) {
      config[key] = value
    }
  }

  return config
}

/**
 * Google GenAI's native SDK models thinking levels as enum values.
 *
 * Exact Gemini 2.5 thinking budgets and thought-output controls remain
 * provider-specific and belong in Google `extra`.
 */
function googleThinkingLevel(reasoning: NonNullable<GenerationSettings['reasoning']>): 'LOW' | 'MEDIUM' | 'HIGH' {
  switch (reasoning) {
    case 'low':
      return 'LOW'
    case 'medium':
      return 'MEDIUM'
    case 'high':
      return 'HIGH'
  }
}

/** Convert a Zod schema into Google structured JSON-output params. */
/**
 * The JSON Schema behavior Gemini's `responseJsonSchema` structured output accepts.
 *
 * Exact per-keyword and envelope conformance is finalized in the Google provider
 * slice; core supplies the compiled schema via `responseJsonSchema`.
 */
export const googleStructuredCapabilities = {
  id: 'google.genai.response-json-schema',
  supportsJsonSchema: true,
  requiresAllProperties: false,
  supportsOptionalProperties: true,
  supportsNullable: true,
  supportsBooleanSchemas: false,
  supportsReferences: true,
  supportsUnions: true,
  supportsRecursiveSchemas: true,
  additionalProperties: 'supported',
  unsupportedKeywords: [],
} satisfies StructuredOutputCapabilities

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
