import type Anthropic from '@anthropic-ai/sdk'
import type { ContentPart } from '@use-crux/core'

/** Map supported Anthropic per-part media options onto content blocks. */
export function anthropicBlockOptions(
  part: Extract<ContentPart, { type: 'image' | 'file' }>,
): Pick<Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam, 'cache_control'> {
  const cacheControl = part.providerOptions?.anthropic?.cache_control
  return isRecord(cacheControl) && cacheControl.type === 'ephemeral' ? { cache_control: { type: 'ephemeral' } } : {}
}

/** Read the effective filename for Anthropic document blocks. */
export function anthropicFilename(part: Extract<ContentPart, { type: 'file' }>): string | undefined {
  if (part.filename) return part.filename
  const source = part.source
  if (typeof source === 'object' && source !== null && 'filename' in source) {
    return typeof source.filename === 'string' ? source.filename : undefined
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
