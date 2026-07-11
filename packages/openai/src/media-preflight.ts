import type { ContentPart, Message, UnsupportedCapabilityIssue } from '@use-crux/core'

// Static, package-private projection consumed by validation today and docs generation later.
const MEDIA_SUPPORT = Object.freeze({
  adapter: 'openai',
  input: Object.freeze(['image', 'file'] as const),
  knownTextOnlyModelPrefixes: Object.freeze(['gpt-3.5'] as const),
})

/** OpenAI media checks consumed by the core-owned pre-request boundary. */
export const openAIMediaHooks = Object.freeze({
  validate: ({
    model,
    messages,
  }: Readonly<{
    model: string
    messages: readonly Message[]
  }>) => validateOpenAIMedia(model, messages),
})

function validateOpenAIMedia(model: string, messages: readonly Message[]): readonly UnsupportedCapabilityIssue[] {
  const issues: UnsupportedCapabilityIssue[] = []
  messages.forEach((message, messageIndex) => {
    indexedMediaParts(message, messageIndex).forEach(({ part, path }) => {
      if (isKnownTextOnlyModel(model)) {
        issues.push(issue(part, path, `Choose an OpenAI model that supports ${part.type} input.`))
        return
      }
      validateRole(message.role, part, path, issues)
      validateSource(part, path, issues)
      validateProviderOptions(part, path.replace(/\.source$/, '.providerOptions.openai'), issues)
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
  return [
    ...content,
    ...indexedParts(modelOutput.value, `messages[${messageIndex}].metadata.modelOutput.value`),
  ]
}

function indexedParts(
  content: Message['content'],
  path: string,
): readonly Readonly<{ part: ContentPart; path: string }>[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((part, partIndex) =>
    isContentPart(part) && part.type !== 'text'
      ? [{ part, path: `${path}[${partIndex}].source` }]
      : [],
  )
}

function validateRole(
  role: Message['role'],
  part: ContentPart,
  path: string,
  issues: UnsupportedCapabilityIssue[],
): void {
  if (part.type === 'text' || role === 'user' || role === 'tool') return
  issues.push(issue(part, path, `Move ${part.type} input to a user message for OpenAI chat completions.`))
}

function validateSource(part: ContentPart, path: string, issues: UnsupportedCapabilityIssue[]): void {
  if (part.type === 'text') return
  const source = part.source
  if (part.type === 'image' && isAsset(source, 'provider-file')) {
    issues.push(
      issue(part, path, 'Hydrate the OpenAI file to an HTTPS URL or byte source before sending it as an image.'),
    )
    return
  }
  if (part.type === 'file' && isAsset(source, 'url')) {
    issues.push(issue(part, path, 'Use byte data or upload the file to OpenAI and pass its provider file ID.'))
    return
  }
  if (part.type === 'file' && isAsset(source, 'data')) {
    const mediaType = part.mediaType ?? source.mediaType
    if (mediaType?.startsWith('audio/') && mediaType !== 'audio/wav' && mediaType !== 'audio/mpeg') {
      issues.push(issue(part, path, 'Use WAV or MP3 audio for OpenAI chat audio input.'))
    }
  }
}

function validateProviderOptions(part: ContentPart, path: string, issues: UnsupportedCapabilityIssue[]): void {
  const options = part.providerOptions?.openai
  if (!options) return
  const unsupportedKeys = Object.keys(options).filter((key) => part.type !== 'image' || key !== 'detail')
  const detail = part.type === 'image' ? options.detail : undefined
  if (
    unsupportedKeys.length === 0 &&
    (detail === undefined || detail === 'auto' || detail === 'low' || detail === 'high')
  ) {
    return
  }
  issues.push(issue(part, path, 'Use only providerOptions.openai.detail with auto, low, or high on image parts.'))
}

function issue(
  part: Exclude<ContentPart, { readonly type: 'text' }> | ContentPart,
  path: string,
  remediation: string,
): UnsupportedCapabilityIssue {
  return {
    capability: `input.${part.type}`,
    path,
    ...(part.type !== 'text' && part.mediaType ? { mediaType: part.mediaType } : {}),
    remediation,
  }
}

function isKnownTextOnlyModel(model: string): boolean {
  return MEDIA_SUPPORT.knownTextOnlyModelPrefixes.some((prefix) => model === prefix || model.startsWith(`${prefix}-`))
}

function isAsset(
  value: unknown,
  type: 'data' | 'url' | 'provider-file',
): value is Readonly<{ type: typeof type; mediaType?: string }> {
  return isRecord(value) && value.type === type
}

function isContentPart(value: unknown): value is ContentPart {
  return isRecord(value) && (value.type === 'text' || value.type === 'image' || value.type === 'file')
}

function isContentModelOutput(
  value: unknown,
): value is Readonly<{ type: 'content'; value: Message['content'] }> {
  return isRecord(value) && value.type === 'content' && Array.isArray(value.value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
