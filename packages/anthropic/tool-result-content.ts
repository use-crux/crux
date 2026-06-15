import type Anthropic from '@anthropic-ai/sdk'
import type { ToolContentPart, ToolModelOutput } from '@crux/core'
import { renderToolContentPartAsText } from '@crux/core/adapter'

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
      return anthropicContentBlocks(modelOutput.value)
  }
}

/** Whether a tool model output should mark Anthropic `tool_result.is_error`. */
export function isErrorToolModelOutput(output: ToolModelOutput | undefined): boolean {
  return output?.type === 'error-text' || output?.type === 'error-json'
}

function anthropicContentBlocks(
  parts: readonly ToolContentPart[],
): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam> {
  return parts.flatMap(
    (part): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam> => {
      switch (part.type) {
        case 'text':
          return [{ type: 'text', text: part.text }]
        case 'image-data':
          return isAnthropicImageMediaType(part.mediaType)
            ? [{ type: 'image', source: { type: 'base64', data: part.data, media_type: part.mediaType } }]
            : [{ type: 'text', text: renderToolContentPartAsText(part) }]
        case 'image-url':
          return [{ type: 'image', source: { type: 'url', url: part.url } }]
        case 'media':
          if (isAnthropicImageMediaType(part.mediaType)) {
            return [{ type: 'image', source: { type: 'base64', data: part.data, media_type: part.mediaType } }]
          }
          if (part.mediaType === 'application/pdf') {
            return [{ type: 'document', source: { type: 'base64', data: part.data, media_type: 'application/pdf' } }]
          }
          return [{ type: 'text', text: renderToolContentPartAsText(part) }]
        case 'file-data':
          if (part.mediaType === 'application/pdf') {
            return [
              {
                type: 'document',
                source: { type: 'base64', data: part.data, media_type: 'application/pdf' },
                ...(part.filename ? { title: part.filename } : {}),
              },
            ]
          }
          return [{ type: 'text', text: renderToolContentPartAsText(part) }]
        default:
          return [{ type: 'text', text: renderToolContentPartAsText(part) }]
      }
    },
  )
}

function isAnthropicImageMediaType(
  mediaType: string,
): mediaType is 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  return (
    mediaType === 'image/jpeg' || mediaType === 'image/png' || mediaType === 'image/gif' || mediaType === 'image/webp'
  )
}
