import type OpenAI from 'openai'
import type { ContentPart, MessageContent } from '@use-crux/core'
import { contentText } from '@use-crux/core'
import { degradeContentPart, degradeContentToText } from '@use-crux/core/adapter'
import type { ContentDegradationContext } from '@use-crux/core/adapter'

type OpenAIContentPart = OpenAI.ChatCompletionContentPart
type OpenAITextPart = OpenAI.ChatCompletionContentPartText

type OpenAIPartEncoder<K extends ContentPart['type']> = (
  part: Extract<ContentPart, { type: K }>,
  context: ContentDegradationContext,
) => OpenAIContentPart[]

/**
 * Encode canonical Crux message content into OpenAI chat-completion content.
 *
 * OpenAI chat accepts rich multimodal parts only on user messages. System,
 * assistant, and tool-result paths use the same table with role-aware
 * degradation so unsupported parts become bounded placeholders instead of raw
 * base64 text.
 */
export function openAIMessageContent(
  role: 'system' | 'assistant',
  content: MessageContent,
  options: Pick<ContentDegradationContext, 'unsupportedContent'>,
): string
export function openAIMessageContent(
  role: 'user',
  content: MessageContent,
  options: Pick<ContentDegradationContext, 'unsupportedContent'>,
): string | OpenAIContentPart[]
export function openAIMessageContent(
  role: 'system' | 'user' | 'assistant',
  content: MessageContent,
  options: Pick<ContentDegradationContext, 'unsupportedContent'>,
): string | OpenAIContentPart[] {
  if (role !== 'user') {
    return degradeContentToText(content, {
      provider: 'openai',
      role,
      unsupportedContent: options.unsupportedContent,
      reason: 'OpenAI chat-completion messages only support rich content on user messages',
    })
  }
  if (typeof content === 'string') return content
  return content.flatMap((part) =>
    encodeOpenAIPart(part, {
      provider: 'openai',
      role,
      unsupportedContent: options.unsupportedContent,
      reason: 'unsupported OpenAI user message content part',
    }),
  )
}

/**
 * Encode canonical tool-result parts for OpenAI tool messages.
 *
 * The OpenAI SDK type only admits text content on `tool` messages, so rich
 * parts deliberately degrade through the shared placeholder grammar rather
 * than a provider-specific base64-inlining fallback.
 */
export function openAIToolResultContent(
  parts: readonly ContentPart[],
  context: ContentDegradationContext,
): OpenAITextPart[] {
  return parts.flatMap((part) => encodeOpenAIPart(part, context).flatMap((encoded) => (isTextPart(encoded) ? [encoded] : [])))
}

/** Decode an OpenAI chat content payload into canonical Crux content. */
export function messageContentFromOpenAIContent(content: unknown): MessageContent {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')

  const parts = content.flatMap((part): ContentPart[] => {
    if (!isRecord(part) || typeof part.type !== 'string') return []
    switch (part.type) {
      case 'text':
        return typeof part.text === 'string' ? [{ type: 'text', text: part.text }] : []
      case 'image_url':
        return isRecord(part.image_url) && typeof part.image_url.url === 'string'
          ? [imageUrlToPart(part.image_url.url)]
          : []
      case 'input_audio':
        if (!isRecord(part.input_audio) || typeof part.input_audio.data !== 'string') return []
        {
          const mediaType = openAIAudioFormatToMediaType(part.input_audio.format)
          return mediaType
            ? [
                {
                  type: 'file-data',
                  data: part.input_audio.data,
                  mediaType,
                },
              ]
            : []
        }
      case 'file':
        return isRecord(part.file) ? fileToPart(part.file) : []
      default:
        return []
    }
  })
  if (parts.length === 0) return ''
  return parts.every((part) => part.type === 'text') ? parts.map((part) => part.text).join('') : parts
}

/** Text projection for decoded OpenAI content payloads. */
export function openAIContentText(content: unknown): string {
  return contentText(messageContentFromOpenAIContent(content))
}

const openAIPartTable = {
  text: (part, _context) => [{ type: 'text', text: part.text }],
  'image-data': (part, context) =>
    context.role === 'user'
      ? [{ type: 'image_url', image_url: { url: `data:${part.mediaType};base64,${part.data}` } }]
      : [degradedTextPart(part, context, 'OpenAI chat-completion images are only supported on user messages')],
  'image-url': (part, context) =>
    context.role === 'user'
      ? [{ type: 'image_url', image_url: { url: part.url } }]
      : [degradedTextPart(part, context, 'OpenAI chat-completion images are only supported on user messages')],
  'image-file-id': (part, context) => [
    degradedTextPart(part, context, 'OpenAI chat completions do not support Crux image file ids'),
  ],
  'file-data': (part, context) => {
    if (context.role !== 'user') {
      return [degradedTextPart(part, context, 'OpenAI chat-completion files are only supported on user messages')]
    }
    const audioFormat = openAIAudioFormat(part.mediaType)
    if (audioFormat) return [{ type: 'input_audio', input_audio: { data: part.data, format: audioFormat } }]
    if (part.mediaType.startsWith('audio/')) {
      return [degradedTextPart(part, context, 'OpenAI chat completions only support wav or mp3 audio input')]
    }
    return [
      {
        type: 'file',
        file: {
          file_data: part.data,
          ...(part.filename ? { filename: part.filename } : {}),
        },
      },
    ]
  },
  'file-url': (part, context) => [
    degradedTextPart(part, context, 'OpenAI chat completions do not support file URL content parts'),
  ],
  'file-id': (part, context) =>
    context.role === 'user' && typeof part.fileId === 'string'
      ? [{ type: 'file', file: { file_id: part.fileId } }]
      : [degradedTextPart(part, context, 'OpenAI chat completions require string file ids')],
  custom: (part, context) => [
    degradedTextPart(part, context, 'OpenAI chat completions do not support custom content parts'),
  ],
} satisfies { readonly [K in ContentPart['type']]: OpenAIPartEncoder<K> }

function encodeOpenAIPart(part: ContentPart, context: ContentDegradationContext): OpenAIContentPart[] {
  switch (part.type) {
    case 'text':
      return openAIPartTable.text(part, context)
    case 'image-data':
      return openAIPartTable['image-data'](part, context)
    case 'image-url':
      return openAIPartTable['image-url'](part, context)
    case 'image-file-id':
      return openAIPartTable['image-file-id'](part, context)
    case 'file-data':
      return openAIPartTable['file-data'](part, context)
    case 'file-url':
      return openAIPartTable['file-url'](part, context)
    case 'file-id':
      return openAIPartTable['file-id'](part, context)
    case 'custom':
      return openAIPartTable.custom(part, context)
  }
}

function degradedTextPart(
  part: ContentPart,
  context: ContentDegradationContext,
  reason: string,
): OpenAITextPart {
  return {
    type: 'text',
    text: degradeContentPart(part, { ...context, reason }).text,
  }
}

function imageUrlToPart(url: string): ContentPart {
  const dataUrl = parseBase64DataUrl(url)
  if (dataUrl) return { type: 'image-data', data: dataUrl.data, mediaType: dataUrl.mediaType }
  return { type: 'image-url', url }
}

function fileToPart(file: Record<string, unknown>): ContentPart[] {
  if (typeof file.file_id === 'string') return [{ type: 'file-id', fileId: file.file_id }]
  if (typeof file.file_data === 'string') {
    return [
      {
        type: 'file-data',
        data: file.file_data,
        mediaType: 'application/octet-stream',
        ...(typeof file.filename === 'string' ? { filename: file.filename } : {}),
      },
    ]
  }
  return []
}

function parseBase64DataUrl(url: string): { mediaType: string; data: string } | undefined {
  const match = /^data:([^;,]+);base64,(.*)$/u.exec(url)
  if (!match) return undefined
  return { mediaType: match[1]!, data: match[2]! }
}

function openAIAudioFormat(mediaType: string): 'wav' | 'mp3' | undefined {
  if (mediaType === 'audio/wav') return 'wav'
  if (mediaType === 'audio/mpeg') return 'mp3'
  return undefined
}

function openAIAudioFormatToMediaType(value: unknown): 'audio/wav' | 'audio/mpeg' | undefined {
  if (value === 'wav') return 'audio/wav'
  if (value === 'mp3') return 'audio/mpeg'
  return undefined
}

function isTextPart(part: OpenAIContentPart): part is OpenAITextPart {
  return part.type === 'text'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
