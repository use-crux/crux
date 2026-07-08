import type Anthropic from '@anthropic-ai/sdk'
import type { ContentPart, MessageContent, ToolModelOutput } from '@use-crux/core'

/** Canonical representation decoded from an Anthropic `tool_result` content payload. */
export interface DecodedAnthropicToolResultContent {
  /** Joined text blocks used as deterministic fallback content. */
  readonly text: string
  /** Structured rich content when the Anthropic payload contained media blocks. */
  readonly modelOutput?: ToolModelOutput
}

/**
 * Decode Anthropic `tool_result` content into canonical text and optional rich output.
 *
 * Text-only results keep their string fallback. Rich image/PDF blocks are
 * reconstructed as `ToolModelOutput` content so a `toMessages()` /
 * `fromMessages()` round trip does not flatten media.
 */
export function decodeAnthropicToolResultContent(
  content: Anthropic.ToolResultBlockParam['content'],
): DecodedAnthropicToolResultContent {
  if (typeof content === 'string') return { text: content }
  if (!Array.isArray(content)) return { text: '' }

  const parts: ContentPart[] = []
  let hasRichPart = false
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      const part = anthropicImageBlockToPart(block.source)
      if (part) {
        parts.push(part)
        hasRichPart = true
      }
    } else if (block.type === 'document' && block.source.type === 'base64') {
      parts.push({
        type: 'file-data',
        data: block.source.data,
        mediaType: block.source.media_type,
        ...(typeof block.title === 'string' ? { filename: block.title } : {}),
      })
      hasRichPart = true
    }
  }

  const text = parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
  return hasRichPart ? { text, modelOutput: { type: 'content', value: parts } } : { text }
}

/** Decode one Anthropic image block source into canonical content. */
export function anthropicImageBlockToPart(source: Anthropic.ImageBlockParam['source']): ContentPart | undefined {
  if (source.type === 'base64') return { type: 'image-data', data: source.data, mediaType: source.media_type }
  if (source.type === 'url') return { type: 'image-url', url: source.url }
  return undefined
}

/** Decode one Anthropic document block into canonical content. */
export function anthropicDocumentBlockToPart(block: Anthropic.DocumentBlockParam): ContentPart | undefined {
  const source = block.source
  if (source.type === 'base64') {
    return {
      type: 'file-data',
      data: source.data,
      mediaType: source.media_type,
      ...(typeof block.title === 'string' ? { filename: block.title } : {}),
    }
  }
  if (source.type === 'url') {
    return {
      type: 'file-url',
      url: source.url,
      mediaType: 'application/pdf',
      ...(typeof block.title === 'string' ? { filename: block.title } : {}),
    }
  }
  return undefined
}

/** Collapse text-only parts to string while preserving rich arrays. */
export function messageContentFromAnthropicParts(parts: readonly ContentPart[]): MessageContent {
  if (parts.length === 0) return ''
  return parts.every((part) => part.type === 'text') ? parts.map((part) => part.text).join('') : parts
}
