import type { SharedV3ProviderMetadata } from '@ai-sdk/provider'

/**
 * Extract provider-reported cost from AI SDK provider metadata.
 *
 * OpenRouter reports cost at `providerMetadata.openrouter.usage.cost`; other
 * providers may expose either `usage.cost` or `cost` on their metadata object.
 */
export function extractCost(providerMetadata: SharedV3ProviderMetadata | undefined): number | undefined {
  if (!providerMetadata) return undefined

  const openrouter = providerMetadata.openrouter as { usage?: { cost?: unknown } } | undefined
  const openRouterCost = openrouter?.usage?.cost
  if (typeof openRouterCost === 'number') return openRouterCost

  for (const provider of Object.values(providerMetadata)) {
    const candidate = provider as { usage?: { cost?: unknown }; cost?: unknown } | undefined
    const cost = candidate?.usage?.cost ?? candidate?.cost
    if (typeof cost === 'number') return cost
  }

  return undefined
}
