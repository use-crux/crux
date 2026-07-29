import type { CruxPromptTextUserPromptPreview } from '../observability/contract'
import type { ResolvedPromptTextInspection } from './prompt-content'
import type { ResolvedPrompt } from './types'

const promptTextObservation = Symbol('crux.prompt-text-observation')

type ResolvedPromptWithObservation = ResolvedPrompt & {
  readonly [promptTextObservation]?: CruxPromptTextUserPromptPreview
}

/**
 * Carries reconstructing PromptText provenance beside provider-neutral text.
 *
 * The symbol survives internal resolved-prompt spreads without becoming a
 * string-keyed provider input or public serialization field.
 */
export function attachPromptTextObservation(
  resolved: ResolvedPrompt,
  inspection: ResolvedPromptTextInspection | undefined,
): void {
  const segments = inspection?.segments
  if (
    !inspection ||
    !segments ||
    segments.length === 0 ||
    segments.map((segment) => segment.text).join('') !== inspection.text
  ) {
    return
  }
  Object.defineProperty(resolved, promptTextObservation, {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({
      kind: 'prompt-text',
      text: inspection.text,
      segments,
      tokens: inspection.tokens,
      staticTokens: inspection.staticTokens ?? 0,
      dynamicTokens: inspection.dynamicTokens ?? 0,
    } satisfies CruxPromptTextUserPromptPreview),
  })
}

/** Read exact PromptText provenance for policy-controlled observability only. */
export function readPromptTextObservation(
  resolved: ResolvedPrompt | undefined,
): CruxPromptTextUserPromptPreview | undefined {
  return (resolved as ResolvedPromptWithObservation | undefined)?.[
    promptTextObservation
  ]
}
