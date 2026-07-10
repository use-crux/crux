import type { ContentPart, Message, UnsupportedCapabilityIssue } from '@use-crux/core'

/** Anthropic media checks consumed by the core-owned pre-request boundary. */
export const anthropicMediaHooks = Object.freeze({
  validate: ({
    model,
    messages,
  }: Readonly<{
    model: string
    messages: readonly Message[]
  }>) => validateAnthropicMedia(model, messages),
})

function validateAnthropicMedia(model: string, messages: readonly Message[]): readonly UnsupportedCapabilityIssue[] {
  const issues: UnsupportedCapabilityIssue[] = []
  messages.forEach((message, messageIndex) => {
    indexedMediaParts(message, messageIndex).forEach(({ part, path }) => {
      if (isKnownTextOnlyModel(model)) {
        issues.push(issue(part, path, `Choose an Anthropic model that supports ${part.type} input.`))
        return
      }
      validateRole(message.role, part, path, issues)
      validateSource(part, path, issues)
      validateProviderOptions(part, path.replace(/\.source$/, '.providerOptions.anthropic'), issues)
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

function validateRole(
  role: Message['role'],
  part: ContentPart,
  path: string,
  issues: UnsupportedCapabilityIssue[],
): void {
  if (part.type === 'text' || role === 'user' || role === 'tool') return
  issues.push(issue(part, path, `Move ${part.type} input to a user message for Anthropic Messages.`))
}

function validateSource(part: ContentPart, path: string, issues: UnsupportedCapabilityIssue[]): void {
  if (part.type === 'text') return
  const source = part.source
  const mediaType = mediaTypeFor(part)

  if (part.type === 'image') {
    if (isAsset(source, 'provider-file')) {
      issues.push(
        issue(part, path, 'Hydrate the Anthropic file to an HTTPS URL or byte source before sending it as an image.'),
      )
    }
    if (mediaType && !isAnthropicImageMediaType(mediaType)) {
      issues.push(issue(part, path, 'Use JPEG, PNG, GIF, or WebP image input for Anthropic.'))
    }
    return
  }

  if (isAsset(source, 'provider-file')) {
    issues.push(
      issue(
        part,
        path,
        'The installed Anthropic stable Messages SDK cannot send Files API ids; hydrate to URL or bytes first.',
        'input.file.provider-file',
      ),
    )
    return
  }
  if (mediaType !== 'application/pdf') {
    issues.push(issue(part, path, 'Anthropic file input supports PDF documents in this adapter.'))
  }
}

function validateProviderOptions(part: ContentPart, path: string, issues: UnsupportedCapabilityIssue[]): void {
  if (part.type === 'text') return
  const options = part.providerOptions?.anthropic
  if (!options) return
  if (Object.keys(options).length === 1 && isCacheControl(options.cache_control)) return
  issues.push(issue(part, path, 'Use only providerOptions.anthropic.cache_control with type ephemeral on media parts.'))
}

function issue(
  part: ContentPart,
  path: string,
  remediation: string,
  capability = `input.${part.type}`,
): UnsupportedCapabilityIssue {
  return {
    capability,
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
  return /^claude-(?:instant|2(?:\.|-|$))/.test(model)
}

function isAnthropicImageMediaType(mediaType: string): boolean {
  return (
    mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/gif' || mediaType === 'image/webp'
  )
}

function isCacheControl(value: unknown): value is Readonly<{ type: 'ephemeral' }> {
  return isRecord(value) && value.type === 'ephemeral' && Object.keys(value).length === 1
}

function isAsset(
  value: unknown,
  type: 'data' | 'url' | 'provider-file',
): value is Readonly<{ type: typeof type; mediaType?: string }> {
  return isRecord(value) && value.type === type
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
