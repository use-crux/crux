/**
 * Shared unsupported-content handling for provider codecs.
 *
 * Adapters call this when a canonical content part cannot be represented by
 * their wire format. The helper owns the strict/degrade policy, diagnostic
 * warning, observability event, and placeholder text projection so providers
 * cannot silently diverge.
 *
 * @module
 */

import { contentText, UnsupportedContentError } from '../content'
import { observe } from '../observability'
import { CRUX_CONTENT_DEGRADED_EVENT } from '../observability/contract'
import type { CruxContentDegradedEventAttributes } from '../observability/contract'
import type { DiagnosticsPort } from '../resolver/ports'
import type { ContentPart, MessageContent } from '../types/content'
import type { Message } from '../generation/messages'

/** Context for degrading or rejecting one unsupported content part. */
export interface ContentDegradationContext {
  /** Provider whose codec is currently encoding content. */
  readonly provider: string
  /** Canonical role being encoded. */
  readonly role: Message['role']
  /** Why this provider cannot represent the part as native media. */
  readonly reason: string
  /** Strict mode rejects before the provider wire call; degrade mode emits text. */
  readonly unsupportedContent?: 'degrade' | 'error'
  /** Optional diagnostics sink; defaults to `console.warn`. */
  readonly diagnostics?: DiagnosticsPort
}

/** Result of degrading one content part into provider-sendable text. */
export interface DegradedContentPart {
  /** Placeholder text produced by the canonical projection grammar. */
  readonly text: string
}

/**
 * Convert an unsupported content part into placeholder text, or throw in strict mode.
 *
 * @param part - Canonical part the provider cannot encode natively.
 * @param context - Provider, role, reason, and strict/degrade policy.
 * @returns Canonical placeholder text for provider text blocks.
 */
export function degradeContentPart(part: ContentPart, context: ContentDegradationContext): DegradedContentPart {
  const mediaType = mediaTypeOf(part)
  if (context.unsupportedContent === 'error') {
    throw new UnsupportedContentError({
      partType: part.type,
      ...(mediaType ? { mediaType } : {}),
      role: context.role,
      provider: context.provider,
      reason: context.reason,
    })
  }

  const text = contentText([part])
  const detail: CruxContentDegradedEventAttributes = {
    partType: part.type,
    ...(mediaType ? { mediaType } : {}),
    role: context.role,
    provider: context.provider,
    reason: context.reason,
  }
  const diagnostics = context.diagnostics ?? consoleDiagnostics
  diagnostics.warn(
    `[@use-crux/core] ${context.provider} degraded unsupported ${part.type} content for ${context.role} messages.`,
    detail,
  )
  observe.event({
    name: CRUX_CONTENT_DEGRADED_EVENT,
    attributes: detail,
  })
  return { text }
}

/**
 * Project content to text while reporting every non-text part as degraded.
 *
 * @param content - Canonical message content to encode through a text-only provider path.
 * @param context - Provider, role, reason, and strict/degrade policy.
 * @returns Text suitable for provider text fields.
 */
export function degradeContentToText(content: MessageContent, context: ContentDegradationContext): string {
  if (typeof content === 'string') return content
  return content.map((part) => (part.type === 'text' ? part.text : degradeContentPart(part, context).text)).join('\n')
}

function mediaTypeOf(part: ContentPart): string | undefined {
  return 'mediaType' in part ? part.mediaType : undefined
}

const consoleDiagnostics: DiagnosticsPort = {
  warn(message, detail) {
    if (detail === undefined) console.warn(message)
    else console.warn(message, detail)
  },
}
