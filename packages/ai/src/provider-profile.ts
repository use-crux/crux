/**
 * Provider quirks, quarantined.
 *
 * The only file in `@use-crux/ai` allowed to branch on provider identity.
 * Everything here is a pure function keyed off `ModelInfo`: Anthropic
 * schema sanitization, Anthropic prompt-cache breakpoints, and model
 * identity extraction.
 *
 * @module
 */

import { jsonSchema as wrapJsonSchema } from 'ai'
import type { LanguageModel } from 'ai'
import type { z } from 'zod'
import type { ModelInfo, SystemBlock } from '@use-crux/core'
import { sanitizeJsonSchema } from '@use-crux/core'

/**
 * Extract provider and model ID from an AI SDK `LanguageModel`.
 *
 * Handles both string IDs (e.g. `"openai:gpt-4o"`) and model objects
 * (which expose `.provider` and `.modelId` properties).
 */
export function extractModelInfo(model: LanguageModel): ModelInfo {
  if (typeof model === 'string') {
    const idx = model.indexOf(':')
    if (idx > 0) {
      return { provider: model.slice(0, idx), modelId: model.slice(idx + 1) }
    }
    return { provider: '', modelId: model }
  }
  const m = model as { provider?: unknown; modelId?: unknown }
  return {
    provider: typeof m.provider === 'string' ? m.provider : '',
    modelId: typeof m.modelId === 'string' ? m.modelId : '',
  }
}

/**
 * Detect whether a model targets Anthropic's API.
 *
 * Handles both direct Anthropic SDK usage (provider = 'anthropic') and
 * OpenRouter-routed Anthropic models (provider = 'openrouter',
 * modelId = 'anthropic/...').
 */
export function isAnthropicModel(modelInfo: ModelInfo): boolean {
  return modelInfo.provider.startsWith('anthropic') || modelInfo.modelId.startsWith('anthropic/')
}

/**
 * For Anthropic models: convert Zod schema → JSON Schema, strip
 * unsupported properties (maxItems, minimum, etc.), and wrap in
 * the AI SDK's `jsonSchema()`. Other providers get the Zod schema as-is.
 *
 * Returns `unknown` because the result is either the original Zod schema
 * or the AI SDK's opaque jsonSchema wrapper — both valid `schema` inputs
 * to `generateObject`/`streamObject`.
 */
export async function sanitizeSchemaForProvider(schema: z.ZodType, modelInfo: ModelInfo): Promise<unknown> {
  if (!isAnthropicModel(modelInfo)) return schema
  const { z: zod } = await import('zod')
  const raw = zod.toJSONSchema(schema) as Record<string, unknown>
  const sanitized = sanitizeJsonSchema(raw, 'anthropic')
  return wrapJsonSchema(sanitized)
}

/** A system message with optional provider-specific cache options. */
export interface SystemMessageWithOptions {
  role: 'system'
  content: string
  providerOptions?: Record<string, unknown>
}

/** Maximum native cache breakpoints Anthropic allows per request. */
const MAX_CACHE_BREAKPOINTS = 4

/**
 * Build the AI SDK `system` argument from resolved system blocks.
 *
 * For Anthropic models with `providerCache` hints, emits an array of
 * system messages carrying native `cacheControl` markers (capped at
 * Anthropic's four-breakpoint limit). Everyone else gets the plain
 * joined string.
 */
export function buildSystemArg(
  systemBlocks: readonly SystemBlock[] | undefined,
  system: string | undefined,
  modelInfo: ModelInfo,
): string | SystemMessageWithOptions[] | undefined {
  if (!system) return undefined
  if (modelInfo && isAnthropicModel(modelInfo) && systemBlocks?.some((b) => b.providerCache)) {
    let breakpointCount = 0
    return systemBlocks.map((block) => {
      const msg: SystemMessageWithOptions = {
        role: 'system',
        content: block.text,
      }
      if (block.providerCache && breakpointCount < MAX_CACHE_BREAKPOINTS) {
        breakpointCount++
        msg.providerOptions = {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        }
      }
      return msg
    })
  }
  return system
}
