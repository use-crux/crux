import type { ContentPart, Message, UnsupportedCapabilityIssue } from '@use-crux/core'
import { estimateGoogleMediaTokens } from './media-token-estimate'

// Static, package-private projection consumed by validation today and docs generation later.
const MEDIA_SUPPORT = Object.freeze({
  adapter: 'google',
  input: Object.freeze(['image', 'file'] as const),
  knownTextOnlyModelPrefixes: Object.freeze(['text-', 'embedding-', 'aqa-', 'imagen-'] as const),
})

/** Google media checks consumed by the core-owned pre-request boundary. */
export const googleMediaHooks = Object.freeze({
  validate: ({
    model,
    messages,
  }: Readonly<{
    model: string
    messages: readonly Message[]
  }>) => validateGoogleMedia(model, messages),
  estimateTokens: estimateGoogleMediaTokens,
})

function validateGoogleMedia(model: string, messages: readonly Message[]): readonly UnsupportedCapabilityIssue[] {
  const issues: UnsupportedCapabilityIssue[] = []
  messages.forEach((message, messageIndex) => {
    indexedMediaParts(message, messageIndex).forEach(({ part, path }) => {
      if (isKnownTextOnlyModel(model)) {
        issues.push(issue(part, path, `Choose a Gemini model that supports ${part.type} input.`))
        return
      }
      validateSource(part, path, issues)
      validateProviderOptions(part, path.replace(/\.source$/, '.providerOptions.google'), issues)
    })
  })
  return issues
}

function indexedMediaParts(
  message: Message,
  messageIndex: number,
): readonly Readonly<{ part: ContentPart; path: string }>[] {
  const content = indexedParts(message.content, `messages[${messageIndex}].content`)
  const modelOutput = message.metadata?.modelOutput
  if (!isContentModelOutput(modelOutput) || modelOutput.value === message.content) return content
  return [...content, ...indexedParts(modelOutput.value, `messages[${messageIndex}].metadata.modelOutput.value`)]
}

function indexedParts(
  content: Message['content'],
  path: string,
): readonly Readonly<{ part: ContentPart; path: string }>[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((part, partIndex) =>
    isContentPart(part) && part.type !== 'text' ? [{ part, path: `${path}[${partIndex}].source` }] : [],
  )
}

function validateSource(part: ContentPart, path: string, issues: UnsupportedCapabilityIssue[]): void {
  if (part.type === 'text') return
  const mediaType = mediaTypeFor(part)
  if (!mediaType) {
    issues.push(issue(part, path, 'Provide a mediaType so Google can send the media natively.'))
    return
  }
  if (!isSupportedGoogleMediaType(mediaType)) {
    issues.push(issue(part, path, 'Use a Google-supported image, PDF, text, audio, or video media type.'))
  }
}

function validateProviderOptions(part: ContentPart, path: string, issues: UnsupportedCapabilityIssue[]): void {
  if (part.type === 'text') return
  const options = part.providerOptions?.google
  if (!options) return
  const keys = Object.keys(options)
  if (
    keys.every((key) => key === 'mediaResolution' || key === 'continuation') &&
    (options.mediaResolution === undefined || isMediaResolution(options.mediaResolution)) &&
    (options.continuation === undefined || isRecord(options.continuation))
  ) return
  issues.push(
    issue(part, path, 'Use only Google media resolution or provider-issued continuation metadata on media parts.'),
  )
}

function issue(part: ContentPart, path: string, remediation: string): UnsupportedCapabilityIssue {
  return {
    capability: `input.${part.type}`,
    path,
    ...(part.type !== 'text' && mediaTypeFor(part) ? { mediaType: mediaTypeFor(part) } : {}),
    remediation,
  }
}

function mediaTypeFor(part: ContentPart): string | undefined {
  if (part.type === 'text') return undefined
  const source = part.source
  return part.mediaType ?? (isAssetWithMediaType(source) ? source.mediaType : undefined)
}

function isKnownTextOnlyModel(model: string): boolean {
  return MEDIA_SUPPORT.knownTextOnlyModelPrefixes.some((prefix) => model.startsWith(prefix))
}

function isSupportedGoogleMediaType(mediaType: string): boolean {
  return (
    mediaType.startsWith('image/') ||
    mediaType.startsWith('audio/') ||
    mediaType.startsWith('video/') ||
    mediaType.startsWith('text/') ||
    mediaType === 'application/pdf' ||
    mediaType === 'application/json'
  )
}

function isMediaResolution(value: unknown): boolean {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length === 0 || keys.some((key) => key !== 'level' && key !== 'numTokens')) return false
  return (
    (value.level === undefined || isGoogleMediaResolutionLevel(value.level)) &&
    (value.numTokens === undefined || isNonNegativeInteger(value.numTokens))
  )
}

function isGoogleMediaResolutionLevel(value: unknown): boolean {
  return (
    value === 'MEDIA_RESOLUTION_UNSPECIFIED' ||
    value === 'MEDIA_RESOLUTION_LOW' ||
    value === 'MEDIA_RESOLUTION_MEDIUM' ||
    value === 'MEDIA_RESOLUTION_HIGH' ||
    value === 'MEDIA_RESOLUTION_ULTRA_HIGH'
  )
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isAssetWithMediaType(value: unknown): value is Readonly<{ mediaType: string }> {
  return isRecord(value) && typeof value.mediaType === 'string'
}

function isContentPart(value: unknown): value is ContentPart {
  return isRecord(value) && (value.type === 'text' || value.type === 'image' || value.type === 'file')
}

function isContentModelOutput(value: unknown): value is Readonly<{ type: 'content'; value: Message['content'] }> {
  return isRecord(value) && value.type === 'content' && Array.isArray(value.value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
