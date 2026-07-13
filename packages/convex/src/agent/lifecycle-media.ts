import {
  createInvalidMediaSourceError,
  createUnsupportedCapabilityError,
} from '@use-crux/core'
import type { Asset, ContentPart, Message } from '@use-crux/core'

type CruxMediaSource = Extract<ContentPart, { type: 'image' | 'file' }>['source']

interface ConvexStorageUrlReader {
  readonly getUrl?: (storageId: string) => Promise<string | null>
}

/** Convert canonical Crux media parts to Convex Agent's AI SDK-native parts. */
export async function prepareAgentCallArgsForNativeMedia(
  ctx: unknown,
  callArgs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const messages = await nativeMessages(callArgs.messages, ctx)
  const prompt = await nativePrompt(callArgs.prompt, ctx)
  return {
    ...callArgs,
    ...(messages ? { messages } : {}),
    ...(prompt ? { prompt } : {}),
  }
}

async function nativePrompt(
  value: unknown,
  ctx: unknown,
): Promise<unknown[] | undefined> {
  if (!Array.isArray(value)) return undefined
  return await nativeMessages(value, ctx)
}

async function nativeMessages(
  value: unknown,
  ctx: unknown,
): Promise<unknown[] | undefined> {
  if (!Array.isArray(value)) return undefined
  return await Promise.all(
    value.map(async (message, messageIndex) => {
      if (!isMessageLike(message)) return message
      return {
        ...message,
        content: await nativeContent(message.content, ctx, messageIndex),
      }
    }),
  )
}

async function nativeContent(
  content: unknown,
  ctx: unknown,
  messageIndex: number,
): Promise<unknown> {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')
  return await Promise.all(
    content.map(async (part, partIndex) => {
      if (!isRecord(part)) return part as Record<string, unknown>
      if (part.type === 'image' && 'source' in part) {
        const contentPart = part as Extract<ContentPart, { type: 'image' }>
        return {
          type: 'image',
          image: await nativeMediaSource(
            contentPart.source,
            'image',
            ctx,
            partPath(messageIndex, partIndex),
          ),
          ...(contentPart.mediaType ? { mediaType: contentPart.mediaType } : {}),
          ...(contentPart.providerOptions ? { providerOptions: contentPart.providerOptions } : {}),
        }
      }
      if (part.type === 'file' && 'source' in part) {
        const contentPart = part as Extract<ContentPart, { type: 'file' }>
        return {
          type: 'file',
          data: await nativeMediaSource(
            contentPart.source,
            'file',
            ctx,
            partPath(messageIndex, partIndex),
          ),
          ...(contentPart.mediaType ? { mediaType: contentPart.mediaType } : {}),
          ...(contentPart.filename ? { filename: contentPart.filename } : {}),
          ...(contentPart.providerOptions ? { providerOptions: contentPart.providerOptions } : {}),
        }
      }
      return { ...part }
    }),
  )
}

async function nativeMediaSource(
  source: CruxMediaSource,
  kind: 'image' | 'file',
  ctx: unknown,
  path: string,
): Promise<unknown> {
  if (typeof source === 'string' || source instanceof URL) return source
  if (source instanceof Uint8Array) return new Uint8Array(source)
  if (source instanceof ArrayBuffer) return new Uint8Array(source)
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    return new Uint8Array(await source.arrayBuffer())
  }
  if (!isAsset(source)) {
    throw createInvalidMediaSourceError({
      path: `${path}.source`,
      reason: 'Convex Agent media source must be usable media.',
    })
  }
  const convexUrl = await convexStoredAssetUrl(source, ctx, `${path}.source`)
  if (convexUrl) return convexUrl
  if (source.type === 'data') return await nativeData(source.data)
  if (source.type === 'url') return source.url
  throw createUnsupportedCapabilityError({
    adapter: 'convex-agent',
    model: '<custom>',
    issues: [
      {
        capability: `input.${kind}.provider-file`,
        path: `${path}.source`,
        mediaType: source.mediaType,
        remediation: 'Use a Convex Agent-native file part or hydrate the file into bytes/URL before the Agent call.',
      },
    ],
  })
}

async function nativeData(data: Extract<Asset, { type: 'data' }>['data']): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return new Uint8Array(data)
  return new Uint8Array(await data.arrayBuffer())
}

async function convexStoredAssetUrl(
  source: Asset,
  ctx: unknown,
  path: string,
): Promise<URL | undefined> {
  const storageId = convexStorageId(source)
  if (!storageId) return undefined
  const storage = isRecord(ctx) && isRecord(ctx.storage)
    ? (ctx.storage as ConvexStorageUrlReader)
    : undefined
  if (!storage?.getUrl) {
    throw createInvalidMediaSourceError({
      path,
      reason: 'Stored Convex media cannot be resolved because ctx.storage.getUrl is unavailable.',
    })
  }
  const url = await storage.getUrl(storageId)
  if (!url) {
    throw createInvalidMediaSourceError({
      path,
      reason: 'Stored Convex media URL is unavailable.',
    })
  }
  try {
    return new URL(url)
  } catch {
    throw createInvalidMediaSourceError({
      path,
      reason: 'Stored Convex media URL is invalid.',
    })
  }
}

function convexStorageId(source: Asset): string | undefined {
  const candidate = source as Asset & { readonly ref?: { readonly uri?: unknown } }
  const ref = isRecord(candidate.ref) && typeof candidate.ref.uri === 'string'
    ? candidate.ref.uri
    : undefined
  if (!ref?.startsWith('convex://')) return undefined
  const storageId = ref.slice('convex://'.length).split('?', 1)[0] ?? ''
  return storageId.length > 0 ? storageId : undefined
}

function isAsset(value: unknown): value is Asset {
  return isRecord(value) && (
    value.type === 'data' ||
    value.type === 'url' ||
    value.type === 'provider-file'
  )
}

function isMessageLike(value: unknown): value is Message {
  return isRecord(value) && typeof value.role === 'string' && 'content' in value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function partPath(messageIndex: number, partIndex: number): string {
  return `messages[${messageIndex}].content[${partIndex}]`
}
