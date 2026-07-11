import type { Message } from '../../generation/messages'
import { countTokens } from '../../shared/tokenizer'
import type { ContentPart } from '../../types/content'
import type { ProviderMediaEstimateInput, ProviderMediaEstimatePart } from './media-hooks'

const UNKNOWN_MEDIA_TOKENS = 4096

export type MessageTokenEstimate = Readonly<{
  totalTokens: number
  textTokens: number
  mediaTokens: number
  usedFallback: boolean
}>

type EstimateContext = Readonly<{
  provider?: string
  model: string
  estimateTokens?: (input: ProviderMediaEstimateInput) => number | undefined
}>

/** Estimate canonical message input from text plus side-effect-free media facts. @internal */
export function estimateMessageTokens(messages: readonly Message[], context: EstimateContext): MessageTokenEstimate {
  const textTokens = countTokens(textOnlyTranscript(messages))
  let mediaTokens = 0
  let usedFallback = false

  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type === 'text') continue
      const media = knownMediaFacts(part)
      const input = Object.freeze({
        ...(context.provider ? { provider: context.provider } : {}),
        model: context.model,
        media,
      })
      const providerEstimate = context.estimateTokens?.(input)
      if (providerEstimate !== undefined) assertValidProviderEstimate(providerEstimate, context)
      const estimate = providerEstimate ?? fallbackMediaTokens(media)
      usedFallback ||= providerEstimate === undefined
      mediaTokens = saturatingAdd(mediaTokens, estimate)
    }
  }

  return Object.freeze({
    totalTokens: saturatingAdd(textTokens, mediaTokens),
    textTokens,
    mediaTokens,
    usedFallback,
  })
}

/** Stable descriptor used only for deterministic unknown-media token fallback. @internal */
export function safeMediaDescriptor(media: ProviderMediaEstimatePart): string {
  return JSON.stringify([
    media.kind,
    media.mediaType ?? null,
    media.size ?? null,
    media.width ?? null,
    media.height ?? null,
    media.durationInSeconds ?? null,
    media.pageCount ?? null,
    media.sourceCategory,
  ])
}

function textOnlyTranscript(messages: readonly Message[]): string {
  return messages.map((message, index) => {
    const content = typeof message.content === 'string'
      ? message.content
      : message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n')
    return `[${index + 1}] ${message.role}: ${content}`
  }).join('\n\n')
}

function knownMediaFacts(part: Extract<ContentPart, { type: 'image' | 'file' }>): ProviderMediaEstimatePart {
  const source = part.source
  const asset = isRecord(source) ? source : undefined
  const data = asset?.type === 'data' ? asset.data : source
  const mediaType = part.mediaType ?? stringFact(asset?.mediaType) ?? blobMediaType(data)
  const size = numberFact(asset?.size) ?? byteLength(data)
  return Object.freeze({
    kind: part.type,
    ...(mediaType ? { mediaType } : {}),
    ...(size !== undefined ? { size } : {}),
    ...optionalNumber('width', asset?.width),
    ...optionalNumber('height', asset?.height),
    ...optionalNumber('durationInSeconds', asset?.durationInSeconds),
    ...optionalNumber('pageCount', asset?.pageCount),
    sourceCategory: sourceCategory(source),
  })
}

function fallbackMediaTokens(media: ProviderMediaEstimatePart): number {
  return saturatingAdd(UNKNOWN_MEDIA_TOKENS, countTokens(safeMediaDescriptor(media)))
}

function assertValidProviderEstimate(value: number, context: EstimateContext): void {
  if (Number.isSafeInteger(value) && value >= 0) return
  throw new TypeError(
    `Provider "${context.provider ?? 'unknown'}" media estimateTokens hook for model "${context.model}" returned invalid token estimate ${String(value)}; expected a non-negative safe integer.`,
  )
}

function saturatingAdd(left: number, right: number): number {
  if (left >= Number.MAX_SAFE_INTEGER - right) return Number.MAX_SAFE_INTEGER
  return left + right
}

function sourceCategory(source: unknown): ProviderMediaEstimatePart['sourceCategory'] {
  if (typeof source === 'string') return source.trimStart().toLowerCase().startsWith('data:') ? 'data-url' : 'url'
  if (source instanceof URL) return 'url'
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) return 'bytes'
  if (isBlob(source)) return 'blob'
  if (!isRecord(source)) return 'unknown'
  if ('ref' in source || source.type === 'asset-ref') return 'asset-ref'
  if (source.type === 'data' || source.type === 'url' || source.type === 'provider-file') return source.type
  return 'unknown'
}

function byteLength(value: unknown): number | undefined {
  if (value instanceof Uint8Array) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  if (isBlob(value)) return value.size
  return undefined
}

function blobMediaType(value: unknown): string | undefined {
  return isBlob(value) && value.type ? value.type : undefined
}

function optionalNumber(key: string, value: unknown): Record<string, number> {
  const number = numberFact(value)
  return number === undefined ? {} : { [key]: number }
}

function numberFact(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function stringFact(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
