import type Anthropic from '@anthropic-ai/sdk'
import type { ContentPart, ToolModelOutput } from '@use-crux/core'
import { degradeContentPart } from '@use-crux/core/adapter'
import type { ContentDegradationContext } from '@use-crux/core/adapter'

export type AnthropicToolResultContent =
  | string
  | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam>

/** Render Crux tool model output into Anthropic `tool_result` content. */
export function anthropicToolResultContent(
  modelOutput: ToolModelOutput | undefined,
  fallback: string,
): AnthropicToolResultContent {
  if (!modelOutput) return fallback

  switch (modelOutput.type) {
    case 'text':
    case 'error-text':
      return modelOutput.value
    case 'json':
    case 'error-json':
      return JSON.stringify(modelOutput.value)
    case 'execution-denied':
      return modelOutput.reason ? `Tool execution denied: ${modelOutput.reason}` : 'Tool execution denied.'
    case 'content':
      return anthropicContentBlocks(modelOutput.value, {
        provider: 'anthropic',
        role: 'tool',
        reason: 'unsupported Anthropic tool-result content part',
      })
  }
}

type AnthropicContentBlockParam = Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam

type AnthropicPartEncoder<K extends ContentPart['type']> = (
  part: Extract<ContentPart, { type: K }>,
  context: ContentDegradationContext,
) => AnthropicContentBlockParam[]

/**
 * Encode canonical content parts into Anthropic content blocks.
 *
 * The table is intentionally exhaustive over `ContentPart['type']` so adding a
 * new canonical kind fails this adapter until it chooses a native mapping or a
 * deliberate degradation path.
 */
export function anthropicContentBlocks(
  parts: readonly ContentPart[],
  context: ContentDegradationContext,
): AnthropicContentBlockParam[] {
  return parts.flatMap((part) => encodeAnthropicPart(part, context))
}

const anthropicPartTable = {
  text: (part, _context) => [{ type: 'text', text: part.text }],
  'image-data': (part, context) =>
    isAnthropicImageMediaType(part.mediaType)
      ? [{ type: 'image', source: { type: 'base64', data: part.data, media_type: part.mediaType } }]
      : [degradedTextBlock(part, context, 'Anthropic image blocks require jpeg, png, gif, or webp media types')],
  'image-url': (part, _context) => [{ type: 'image', source: { type: 'url', url: part.url } }],
  'image-file-id': (part, context) => [
    degradedTextBlock(part, context, 'Anthropic messages do not support Crux image file ids'),
  ],
  'file-data': (part, context) =>
    part.mediaType === 'application/pdf'
      ? [
          {
            type: 'document',
            source: { type: 'base64', data: part.data, media_type: 'application/pdf' },
            ...(part.filename ? { title: part.filename } : {}),
          },
        ]
      : [degradedTextBlock(part, context, 'Anthropic document blocks only support PDF file data')],
  'file-url': (part, context) =>
    part.mediaType === 'application/pdf'
      ? [
          {
            type: 'document',
            source: { type: 'url', url: part.url },
            ...(part.filename ? { title: part.filename } : {}),
          },
        ]
      : [degradedTextBlock(part, context, 'Anthropic URL document blocks only support PDF files')],
  'file-id': (part, context) => [
    degradedTextBlock(part, context, 'Anthropic messages do not support Crux file ids'),
  ],
  custom: (part, context) => [
    degradedTextBlock(part, context, 'Anthropic messages do not support custom content parts'),
  ],
} satisfies { readonly [K in ContentPart['type']]: AnthropicPartEncoder<K> }

function degradedTextBlock(part: ContentPart, context: ContentDegradationContext, reason: string): Anthropic.TextBlockParam {
  return {
    type: 'text',
    text: degradeContentPart(part, { ...context, reason }).text,
  }
}

function encodeAnthropicPart(part: ContentPart, context: ContentDegradationContext): AnthropicContentBlockParam[] {
  switch (part.type) {
    case 'text':
      return anthropicPartTable.text(part, context)
    case 'image-data':
      return anthropicPartTable['image-data'](part, context)
    case 'image-url':
      return anthropicPartTable['image-url'](part, context)
    case 'image-file-id':
      return anthropicPartTable['image-file-id'](part, context)
    case 'file-data':
      return anthropicPartTable['file-data'](part, context)
    case 'file-url':
      return anthropicPartTable['file-url'](part, context)
    case 'file-id':
      return anthropicPartTable['file-id'](part, context)
    case 'custom':
      return anthropicPartTable.custom(part, context)
  }
}

function isAnthropicImageMediaType(
  mediaType: string,
): mediaType is 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  return (
    mediaType === 'image/jpeg' || mediaType === 'image/png' || mediaType === 'image/gif' || mediaType === 'image/webp'
  )
}
