import type { UnsupportedCapabilityIssue } from '../../content/media-errors'
import { createUnsupportedCapabilityError } from '../../content/media-errors'
import type { Message } from '../../generation/messages'

/** Provider-owned media checks used only while compiling a native request. */
export type ProviderMediaHooks = Readonly<{
  validate?: (
    input: Readonly<{
      provider?: string
      model: string
      messages: readonly Message[]
    }>,
  ) => readonly UnsupportedCapabilityIssue[]
}>

/** Run provider media checks and throw one safe aggregate before request encoding. */
export function assertProviderMediaSupported(
  profile: Readonly<{
    providerId: string
    media?: ProviderMediaHooks
  }>,
  input: Readonly<{ provider?: string; model: string; messages: readonly Message[] }>,
): void {
  const issues = profile.media?.validate?.(input)
  if (!isNonEmpty(issues)) return
  throw createUnsupportedCapabilityError({
    adapter: profile.providerId,
    model: input.model,
    issues,
  })
}

function isNonEmpty<T>(values: readonly T[] | undefined): values is readonly [T, ...T[]] {
  return values !== undefined && values.length > 0
}
