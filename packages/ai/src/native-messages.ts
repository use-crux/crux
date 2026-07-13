import type { Message } from '@use-crux/core'
import { normalizeAiSdkMessages } from './messages'
import { isRecord, readString } from './object-utils'
import type { AIMessageHistory } from './options'

interface PreparedAiSdkMessages {
  readonly messages: Message[] | undefined
  readonly nativeMessages: readonly unknown[] | undefined
}

export function prepareAiSdkMessages(messages: AIMessageHistory | undefined): PreparedAiSdkMessages {
  if (!messages || messages.length === 0) {
    return { messages: undefined, nativeMessages: undefined }
  }
  return {
    messages: normalizeAiSdkMessages(
      messages as ReadonlyArray<{
        role: string
        content: unknown
        [key: string]: unknown
      }>,
    ),
    nativeMessages: messages.some(hasNativeAiSdkShape) ? messages.map(copyNativeMessage) : undefined,
  }
}

function copyNativeMessage(message: unknown): unknown {
  if (!isRecord(message)) return message
  return {
    ...message,
    ...(Array.isArray(message.content) ? { content: [...message.content] } : {}),
  }
}

function hasNativeAiSdkShape(message: unknown): boolean {
  if (!isRecord(message)) return false
  if (isRecord(message.providerOptions)) return true
  return Array.isArray(message.content) && message.content.some(hasNativeAiSdkPartShape)
}

function hasNativeAiSdkPartShape(part: unknown): boolean {
  if (!isRecord(part)) return false
  const type = readString(part, 'type')
  if (type === 'image') return 'image' in part && !('source' in part)
  if (type === 'file') return 'data' in part && !('source' in part)
  return type === 'tool-call' || type === 'tool-result' || type === 'tool-approval-request' || type === 'reasoning'
}
