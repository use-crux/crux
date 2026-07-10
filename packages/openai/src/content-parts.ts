import type OpenAI from 'openai'
import { contentText, createUnsupportedCapabilityError, type ContentPart, type MessageContent } from '@use-crux/core'
import { encodeOpenAIContentPart } from './media-encoding'

type OpenAIContentPart = OpenAI.ChatCompletionContentPart

/** Encode canonical Crux message content into OpenAI chat-completion content. */
export function openAIMessageContent(role: 'system' | 'assistant', content: MessageContent): string
export function openAIMessageContent(role: 'user', content: MessageContent): string | OpenAIContentPart[]
export function openAIMessageContent(
  role: 'system' | 'user' | 'assistant',
  content: MessageContent,
): string | OpenAIContentPart[] {
  if (typeof content === 'string') return content
  if (role !== 'user' && content.some((part) => part.type !== 'text')) {
    throw unsupported(`input.media.${role}`, `${role} messages do not accept media content in OpenAI chat completions.`)
  }
  if (role !== 'user') return contentText(content)
  return content.flatMap(encodeOpenAIContentPart)
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
          ? [{ type: 'image', source: part.image_url.url }]
          : []
      case 'input_audio':
        if (!isRecord(part.input_audio) || typeof part.input_audio.data !== 'string') return []
        {
          const mediaType = openAIAudioFormatToMediaType(part.input_audio.format)
          return mediaType
            ? [
                {
                  type: 'file',
                  source: dataAsset(part.input_audio.data, mediaType),
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

function dataAsset(data: string, mediaType: string): Extract<ContentPart, { type: 'file' }>['source'] {
  return {
    type: 'data',
    data: new Uint8Array(Buffer.from(data, 'base64')),
    mediaType,
  }
}

function fileToPart(file: Record<string, unknown>): ContentPart[] {
  if (typeof file.file_id === 'string')
    return [
      {
        type: 'file',
        source: {
          type: 'provider-file',
          provider: 'openai',
          fileId: file.file_id,
        },
      },
    ]
  if (typeof file.file_data === 'string') {
    return [
      {
        type: 'file',
        source: dataAsset(file.file_data, 'application/octet-stream'),
        mediaType: 'application/octet-stream',
        ...(typeof file.filename === 'string' ? { filename: file.filename } : {}),
      },
    ]
  }
  return []
}

function openAIAudioFormatToMediaType(value: unknown): 'audio/wav' | 'audio/mpeg' | undefined {
  if (value === 'wav') return 'audio/wav'
  if (value === 'mp3') return 'audio/mpeg'
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unsupported(capability: string, remediation: string): never {
  throw createUnsupportedCapabilityError({
    adapter: 'openai',
    model: '<custom>',
    issues: [{ capability, remediation }],
  })
}
