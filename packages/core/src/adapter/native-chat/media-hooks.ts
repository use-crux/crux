import type { UnsupportedCapabilityIssue } from '../../content/media-errors'
import { createUnsupportedCapabilityError } from '../../content/media-errors'
import type { Message } from '../../generation/messages'

const providerMediaHooksKey = Symbol('crux.provider.media-hooks')

/** Provider-owned media facts supplied at a side-effect-free request boundary. */
export type ProviderMediaInput = Readonly<{
  provider?: string
  model: string
  messages: readonly Message[]
}>

/** Already-known media facts available to a pure provider estimator. */
export type ProviderMediaEstimatePart = Readonly<{
  kind: 'image' | 'file'
  mediaType?: string
  size?: number
  width?: number
  height?: number
  durationInSeconds?: number
  pageCount?: number
  sourceCategory: 'asset-ref' | 'blob' | 'bytes' | 'data' | 'data-url' | 'provider-file' | 'unknown' | 'url'
}>

/** Provider/model identity plus one media part's safe, already-known facts. */
export type ProviderMediaEstimateInput = Readonly<{
  provider?: string
  model: string
  media: ProviderMediaEstimatePart
}>

/** Provider-owned media checks used only while compiling a native request. */
export type ProviderMediaHooks = Readonly<{
  validate?: (input: ProviderMediaInput) => readonly UnsupportedCapabilityIssue[]
  estimateTokens?: (input: ProviderMediaEstimateInput) => number | undefined
}>

type InternalMediaCarrier = Readonly<{ [providerMediaHooksKey]?: ProviderMediaHooks }>

/** Attach hooks to compiler IR without adding a public string-keyed field. */
export function attachProviderMediaHooks<T extends object>(target: T, hooks: ProviderMediaHooks | undefined): T {
  if (!hooks) return target
  Object.defineProperty(target, providerMediaHooksKey, { value: hooks, enumerable: false })
  return target
}

/** Read compiler-private hooks from single-turn execution IR. */
export function providerMediaHooksFor(target: object): ProviderMediaHooks | undefined {
  return (target as InternalMediaCarrier)[providerMediaHooksKey]
}

/** Run provider media checks and throw one safe aggregate before request encoding. */
export function assertProviderMediaSupported(
  profile: Readonly<{
    providerId: string
    media?: ProviderMediaHooks
  }>,
  input: ProviderMediaInput,
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
