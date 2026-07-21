import { contentText, type ContentPart } from '@use-crux/core'
import type {
  ModelIngressDocument,
  ModelIngressPatch,
  ToolModelInputOrigin,
} from '@use-crux/core/adapter'
import type { MediaPartSubject } from '@use-crux/core/safety'
import type { AiSdkToolResultOutput } from './tool-model-ingress'

type AiSdkContentOutput = Extract<AiSdkToolResultOutput, { readonly type: 'content' }>
type AiSdkContentPart = AiSdkContentOutput['value'][number]

/** @internal Project native AI SDK content into Core-owned semantic slots. */
export function aiSdkToolContentDocument(
  output: AiSdkContentOutput,
  origin: ToolModelInputOrigin,
  provider: string | undefined,
): ModelIngressDocument<AiSdkContentOutput> {
  return {
    kind: 'document',
    value: output,
    origin,
    slots: output.value.map((part, partIndex) => {
      const key = partKey(partIndex)
      switch (part.type) {
        case 'text':
          return { kind: 'text', key, value: part.text }
        case 'custom':
          return { kind: 'opaque', key, descriptor: '[opaque custom]' }
        case 'media':
        case 'image-data':
        case 'image-url':
        case 'image-file-id':
        case 'file-data':
        case 'file-url':
        case 'file-id': {
          const subjects = mediaSubjects(part, origin, partIndex, provider)
          return {
            kind: 'media',
            key,
            descriptor: mediaDescriptor(part, subjects),
            subjects,
          }
        }
        default:
          return assertNever(part)
      }
    }),
  }
}

/** @internal Apply semantic edits to the original AI SDK content value. */
export function applyAiSdkToolContentPatch(
  output: AiSdkContentOutput,
  patch: ModelIngressPatch,
): AiSdkContentOutput {
  if (patch.removed.size === 0 && patch.text.size === 0) return output
  const value: AiSdkContentPart[] = []
  for (let partIndex = 0; partIndex < output.value.length; partIndex++) {
    const part = output.value[partIndex]
    if (!part) continue
    const key = partKey(partIndex)
    if (patch.removed.has(key)) continue
    const replacement = patch.text.get(key)
    value.push(
      part.type === 'text' && replacement !== undefined && replacement !== part.text
        ? { ...part, text: replacement }
        : part,
    )
  }
  return { ...output, value }
}

function mediaSubjects(
  part: Exclude<AiSdkContentPart, { readonly type: 'text' | 'custom' }>,
  origin: ToolModelInputOrigin,
  partIndex: number,
  provider: string | undefined,
): readonly [MediaPartSubject, ...MediaPartSubject[]] {
  const semanticOrigin = {
    kind: 'tool-result' as const,
    toolName: origin.toolName,
    ...(origin.toolCallId !== undefined ? { toolCallId: origin.toolCallId } : {}),
    partIndex,
  }
  if (part.type === 'file-id' || part.type === 'image-file-id') {
    const type = part.type === 'image-file-id' ? 'image' : 'file'
    return providerNames(part.fileId, provider).map((name) => ({
      part: {
        type,
        source: {
          type: 'provider-file',
          provider: name,
          fileId: '<redacted>',
        },
      },
      origin: semanticOrigin,
    })) as [MediaPartSubject, ...MediaPartSubject[]]
  }

  const semantic = semanticMediaPart(part)
  return [{ part: semantic, origin: semanticOrigin }]
}

function semanticMediaPart(
  part: Exclude<
    AiSdkContentPart,
    { readonly type: 'text' | 'custom' | 'file-id' | 'image-file-id' }
  >,
): Exclude<ContentPart, { readonly type: 'text' }> {
  switch (part.type) {
    case 'media': {
      const type = part.mediaType.toLowerCase().startsWith('image/') ? 'image' : 'file'
      return {
        type,
        source: dataUrl(part.data, part.mediaType),
        mediaType: part.mediaType,
      }
    }
    case 'image-data':
      return {
        type: 'image',
        source: dataUrl(part.data, part.mediaType),
        mediaType: part.mediaType,
      }
    case 'file-data':
      return {
        type: 'file',
        source: dataUrl(part.data, part.mediaType),
        mediaType: part.mediaType,
        ...(part.filename !== undefined ? { filename: part.filename } : {}),
      }
    case 'image-url':
      return { type: 'image', source: part.url }
    case 'file-url':
      return { type: 'file', source: part.url }
    default:
      return assertNever(part)
  }
}

function mediaDescriptor(
  part: Exclude<AiSdkContentPart, { readonly type: 'text' | 'custom' }>,
  subjects: readonly [MediaPartSubject, ...MediaPartSubject[]],
): string {
  if (part.type === 'file-id') return '[file provider-file]'
  if (part.type === 'image-file-id') return '[image provider-file]'
  return contentText([subjects[0].part])
}

function providerNames(
  fileId: string | Record<string, string>,
  provider: string | undefined,
): readonly [string, ...string[]] {
  const names = typeof fileId === 'string' ? [provider ?? '<unknown>'] : Object.keys(fileId)
  const normalized = [...new Set(names.map(normalizeProviderName))].sort()
  return (normalized.length > 0 ? normalized : ['<unknown>']) as [string, ...string[]]
}

function normalizeProviderName(value: string): string {
  const name = value.trim()
  return name === '' ? '<unknown>' : name
}

function dataUrl(data: string, mediaType: string): string {
  return `data:${mediaType};base64,${data}`
}

function partKey(partIndex: number): string {
  return `part:${partIndex}`
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported AI SDK tool content part: ${String(value)}`)
}
