import type { ProviderOptions } from './tool'

/**
 * Canonical multimodal content part.
 *
 * Content parts are JSON-serializable by design: binary payloads are base64
 * strings, URLs are strings, and provider-specific escape hatches live in
 * `providerOptions`.
 */
export type ContentPart =
  | { type: 'text'; text: string; providerOptions?: ProviderOptions }
  | { type: 'image-data'; data: string; mediaType: string; providerOptions?: ProviderOptions }
  | { type: 'image-url'; url: string; mediaType?: string; providerOptions?: ProviderOptions }
  | { type: 'image-file-id'; fileId: string | Record<string, string>; providerOptions?: ProviderOptions }
  | { type: 'file-data'; data: string; mediaType: string; filename?: string; providerOptions?: ProviderOptions }
  | { type: 'file-url'; url: string; mediaType?: string; filename?: string; providerOptions?: ProviderOptions }
  | { type: 'file-id'; fileId: string | Record<string, string>; providerOptions?: ProviderOptions }
  | { type: 'custom'; providerOptions?: ProviderOptions }

/** Canonical message content: legacy text or structured multimodal parts. */
export type MessageContent = string | readonly ContentPart[]
