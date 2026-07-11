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
  estimateTokens: estimateAiSdkMediaTokens,
})

type MediaTokenInput = Readonly<{
  provider?: string
  model: string
  media: Readonly<{
    kind: 'image' | 'file'
    mediaType?: string
    width?: number
    height?: number
    durationInSeconds?: number
  }>
}>

/** Estimate from stable AI SDK provider/model identity and known scalar facts only. */
export function estimateAiSdkMediaTokens(input: MediaTokenInput): number | undefined {
  const identity = stableIdentity(input.provider, input.model)
  // https://docs.anthropic.com/en/docs/build-with-claude/vision (verified 2026-07-11)
  if (identity.provider === 'anthropic' && input.media.kind === 'image') {
    const { width, height } = input.media
    if (!/^claude-(?:3|(?:haiku|sonnet|opus)-4)/.test(identity.model) || !positive(width) || !positive(height)) {
      return undefined
    }
    const pixels = width * height
    return Number.isSafeInteger(pixels) ? Math.ceil(pixels / 750) : undefined
  }
  // https://ai.google.dev/gemini-api/docs/audio (verified 2026-07-11)
  if (identity.provider === 'google' && input.media.mediaType?.startsWith('audio/')) {
    const duration = input.media.durationInSeconds
    if (!/^gemini-/.test(identity.model) || duration === undefined || !Number.isFinite(duration) || duration < 0) {
      return undefined
    }
    const estimate = Math.ceil(duration * 32)
    return Number.isSafeInteger(estimate) ? estimate : undefined
  }
  return undefined
}

function stableIdentity(provider: string | undefined, model: string): Readonly<{ provider: string; model: string }> {
  if (provider?.startsWith('anthropic')) return { provider: 'anthropic', model }
  if (provider?.startsWith('google')) return { provider: 'google', model }
  for (const known of ['anthropic', 'google'] as const) {
    if (model.startsWith(`${known}/`)) return { provider: known, model: model.slice(known.length + 1) }
  }
  return { provider: provider ?? '', model }
}

function positive(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
}

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
