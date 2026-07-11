import type { ContentPart, Message, UnsupportedCapabilityIssue } from '@use-crux/core'

// Static, package-private projection shared by AI SDK and Convex Agent identity checks.
const MEDIA_SUPPORT = Object.freeze({
  adapter: 'ai-sdk',
  input: Object.freeze(['image', 'file'] as const),
  knownTextOnlyModelPrefixes: Object.freeze({
    openai: Object.freeze(['gpt-3.5'] as const),
    anthropic: Object.freeze(['claude-instant', 'claude-2'] as const),
    google: Object.freeze(['text-', 'embedding-', 'aqa-', 'imagen-'] as const),
  }),
})

/** AI SDK media checks consumed by core's private loop-owned request boundary. */
export const aiSdkMediaHooks = Object.freeze({
  validate: ({
    provider,
    model,
    messages,
  }: Readonly<{ provider?: string; model: string; messages: readonly Message[] }>) =>
    validateAiSdkMedia(provider, model, messages),
})

function validateAiSdkMedia(
  provider: string | undefined,
  model: string,
  messages: readonly Message[],
): readonly UnsupportedCapabilityIssue[] {
  if (!isKnownTextOnlyModel(provider, model)) return []
  return messages.flatMap((message, messageIndex) => mediaIssues(message, messageIndex))
}

function mediaIssues(message: Message, messageIndex: number): readonly UnsupportedCapabilityIssue[] {
  if (!Array.isArray(message.content)) return []
  return message.content.flatMap((part, partIndex) =>
    isMediaPart(part)
      ? [
          {
            capability: `input.${part.type}`,
            path: `messages[${messageIndex}].content[${partIndex}].source`,
            ...(mediaTypeFor(part) ? { mediaType: mediaTypeFor(part) } : {}),
            remediation: 'Choose a model that supports media input.',
          },
        ]
      : [],
  )
}

function isKnownTextOnlyModel(provider: string | undefined, model: string): boolean {
  if (provider === 'openai') return isOpenAITextOnly(model)
  if (provider === 'anthropic') return isAnthropicTextOnly(model)
  if (provider === 'google' || provider === 'google.generative-ai') {
    return isGoogleTextOnly(model)
  }
  return (
    (model.startsWith('openai/') && isOpenAITextOnly(model.slice('openai/'.length))) ||
    (model.startsWith('anthropic/') && isAnthropicTextOnly(model.slice('anthropic/'.length))) ||
    (model.startsWith('google/') && isGoogleTextOnly(model.slice('google/'.length)))
  )
}

function isOpenAITextOnly(model: string): boolean {
  return MEDIA_SUPPORT.knownTextOnlyModelPrefixes.openai.some(
    (prefix) => model === prefix || model.startsWith(`${prefix}-`),
  )
}

function isAnthropicTextOnly(model: string): boolean {
  return MEDIA_SUPPORT.knownTextOnlyModelPrefixes.anthropic.some(
    (prefix) => model === prefix || model.startsWith(`${prefix}.`) || model.startsWith(`${prefix}-`),
  )
}

function isGoogleTextOnly(model: string): boolean {
  return MEDIA_SUPPORT.knownTextOnlyModelPrefixes.google.some((prefix) => model.startsWith(prefix))
}

function isMediaPart(part: ContentPart): part is Extract<ContentPart, { type: 'image' | 'file' }> {
  return part.type === 'image' || part.type === 'file'
}

function mediaTypeFor(part: Extract<ContentPart, { type: 'image' | 'file' }>): string | undefined {
  if (part.mediaType) return part.mediaType
  const source = part.source
  return typeof source === 'object' && source !== null && 'mediaType' in source && typeof source.mediaType === 'string'
    ? source.mediaType
    : undefined
}
