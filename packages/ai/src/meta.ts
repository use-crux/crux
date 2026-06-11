/**
 * Provider-metadata extraction and error classification for the AI SDK
 * executor — pure functions only, no SDK calls.
 *
 * @module
 */

import type { AdapterResponse } from '@crux/core/adapter'

// ─────────────────────────────────────────────────────────────────
// Cost extraction
// ─────────────────────────────────────────────────────────────────

type ProviderCostEntry = { usage?: { cost?: unknown }; cost?: unknown }

/**
 * Extract cost from providerMetadata if the provider returns it.
 *
 * Currently only OpenRouter includes cost in responses
 * (`providerMetadata.openrouter.usage.cost`). This also checks
 * other providers generically in case they add cost support.
 */
export function extractCost(providerMetadata: unknown): number | undefined {
  if (!providerMetadata || typeof providerMetadata !== 'object') return undefined
  const meta = providerMetadata as Record<string, ProviderCostEntry | undefined>
  // OpenRouter: providerMetadata.openrouter.usage.cost
  const orCost = meta.openrouter?.usage?.cost
  if (typeof orCost === 'number') return orCost
  // Generic: check any provider that exposes a cost field
  for (const provider of Object.values(meta)) {
    const cost = provider?.usage?.cost ?? provider?.cost
    if (typeof cost === 'number') return cost
  }
  return undefined
}

// ─────────────────────────────────────────────────────────────────
// Usage normalization
// ─────────────────────────────────────────────────────────────────

/** Structural shape of AI SDK usage objects we normalize from. */
export interface SdkUsageLike {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }
  outputTokenDetails?: { reasoningTokens?: number }
}

/** Normalize AI SDK usage to the canonical `AdapterResponse` usage shape. */
export function normalizeUsage(usage: SdkUsageLike | undefined): AdapterResponse['usage'] {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens,
  }
}

// ─────────────────────────────────────────────────────────────────
// Structured-output error classification
// ─────────────────────────────────────────────────────────────────

/**
 * Check if an error is an object generation error (validation/parse failure).
 * AI SDK throws `NoObjectGeneratedError` when structured output fails.
 */
export function isObjectGenerationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.name === 'NoObjectGeneratedError' ||
    error.name === 'AI_NoObjectGeneratedError' ||
    error.name === 'TypeValidationError' ||
    error.name === 'JSONParseError' ||
    error.message.includes('did not match the expected schema') ||
    error.message.includes('Failed to parse')
  )
}

/** Best-effort extraction of the model's raw text from a structured-output error. */
export function extractRawTextFromError(error: unknown): string {
  const errObj = error as { text?: unknown; response?: { text?: unknown } } | null
  if (typeof errObj?.text === 'string') return errObj.text
  if (typeof errObj?.response?.text === 'string') return errObj.response.text
  return ''
}

/**
 * Extract a ZodError from an AI SDK validation error.
 * Falls back to a synthetic ZodError if the error doesn't carry one.
 */
export async function extractZodError(error: unknown): Promise<import('zod').ZodError> {
  // AI SDK errors may carry .cause which is the original ZodError
  const cause = (error as { cause?: unknown } | null)?.cause
  if (cause && typeof cause === 'object' && 'issues' in cause) {
    return cause as import('zod').ZodError
  }

  const { ZodError } = await import('zod')
  return new ZodError([
    {
      code: 'custom',
      path: [],
      message: error instanceof Error ? error.message : String(error),
    },
  ])
}
