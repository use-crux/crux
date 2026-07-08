import type { ContentPart } from '../types/content'
import type { Message } from '../generation/messages'

/** Context captured when a provider cannot represent a canonical content part. */
export interface UnsupportedContentErrorOptions {
  /** Canonical content part type that could not be represented. */
  readonly partType: ContentPart['type']
  /** Media type attached to the part, when available. */
  readonly mediaType?: string
  /** Message role being encoded when the unsupported part was found. */
  readonly role?: Message['role']
  /** Provider whose codec rejected the part. */
  readonly provider?: string
  /** Human-readable reason for the rejection. */
  readonly reason?: string
}

/** Error thrown when strict multimodal encoding rejects unsupported content. */
export class UnsupportedContentError extends Error {
  override readonly name = 'UnsupportedContentError'
  readonly partType: ContentPart['type']
  readonly mediaType?: string
  readonly role?: Message['role']
  readonly provider?: string
  readonly reason?: string

  constructor(options: UnsupportedContentErrorOptions) {
    const provider = options.provider ? `${options.provider} ` : ''
    const mediaType = options.mediaType ? ` (${options.mediaType})` : ''
    const role = options.role ? ` for ${options.role} messages` : ''
    const reason = options.reason ? `: ${options.reason}` : ''
    super(`${provider}does not support ${options.partType}${mediaType}${role}${reason}`)
    this.partType = options.partType
    this.mediaType = options.mediaType
    this.role = options.role
    this.provider = options.provider
    this.reason = options.reason
  }
}
