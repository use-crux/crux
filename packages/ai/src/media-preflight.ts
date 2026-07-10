import type { ContentPart, Message, UnsupportedCapabilityIssue } from '@use-crux/core'

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
  if (provider === 'openai') return /^gpt-3\.5(?:-|$)/.test(model)
  if (provider === 'anthropic') return /^claude-(?:instant|2(?:\.|-|$))/.test(model)
  if (provider === 'google' || provider === 'google.generative-ai') {
    return /^(?:text-|embedding-|aqa-|imagen-)/.test(model)
  }
  return (
    /^openai\/gpt-3\.5(?:-|$)/.test(model) ||
    /^anthropic\/claude-(?:instant|2(?:\.|-|$))/.test(model) ||
    /^google\/(?:text-|embedding-|aqa-|imagen-)/.test(model)
  )
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
