/**
 * Provider-neutral fixtures for direct adapter media conformance.
 *
 * These helpers describe the semantic Crux input once while provider packages
 * keep their own SDK-shaped request assertions. They perform no I/O and never
 * retain secret media locators beyond deterministic test values.
 *
 * @module
 */

import type { Message } from '../../generation/messages'
import type { ContentPart } from '../../types/content'

/** Stable provider id used by direct media conformance fixtures. */
export type DirectMediaProvider = 'anthropic' | 'google' | 'openai'

/** Canonical messages and values shared by direct adapter media tests. */
export type DirectMediaFixture = Readonly<{
  messages: readonly Message[]
  imageUrl: URL
  pdfBytes: Uint8Array
  providerFileId: string
}>

/**
 * Create one ordered text/image/file/provider-file direct media fixture.
 *
 * Provider packages may omit the provider-file message when their installed SDK
 * cannot represent a native file-id request. The remaining messages still cover
 * URL/data lowering, MIME, filename, provider options, and transcript identity.
 */
export function directMediaFixture(provider: DirectMediaProvider): DirectMediaFixture {
  const imageUrl = new URL('https://example.com/chart.png?token=fixture')
  const pdfBytes = new Uint8Array([4, 5, 6])
  const providerFileId = `${provider}-file-fixture`
  const content = Object.freeze([
    { type: 'text', text: 'Compare these.' },
    {
      type: 'image',
      source: imageUrl,
      mediaType: 'image/png',
      providerOptions: Object.freeze({
        anthropic: Object.freeze({
          cache_control: Object.freeze({ type: 'ephemeral' }),
        }),
        openai: Object.freeze({ detail: 'high' }),
        google: Object.freeze({
          mediaResolution: Object.freeze({ level: 'MEDIA_RESOLUTION_LOW' }),
        }),
      }),
    },
    {
      type: 'file',
      source: pdfBytes,
      mediaType: 'application/pdf',
      filename: 'quarterly.pdf',
    },
    {
      type: 'file',
      source: Object.freeze({
        type: 'provider-file',
        provider,
        fileId: providerFileId,
        mediaType: 'application/pdf',
        filename: 'uploaded.pdf',
      }),
    },
  ] satisfies readonly ContentPart[])
  const messages = Object.freeze([
    {
      role: 'user',
      content,
    },
  ] satisfies readonly Message[])
  return Object.freeze({
    imageUrl,
    pdfBytes,
    providerFileId,
    messages,
  })
}

/** Create a media message with a provider-file asset owned by another adapter. */
export function wrongProviderFileMessages(provider: DirectMediaProvider): readonly Message[] {
  const wrongProvider = provider === 'google' ? 'anthropic' : 'google'
  const content = Object.freeze([
    {
      type: 'file',
      source: Object.freeze({
        type: 'provider-file',
        provider: wrongProvider,
        fileId: 'wrong-provider-secret',
        mediaType: 'application/pdf',
      }),
    },
  ] satisfies readonly ContentPart[])
  return Object.freeze([
    {
      role: 'user',
      content,
    },
  ] satisfies readonly Message[])
}

/** Assert that a generated canonical transcript reused the caller's message. */
export function assertDirectMediaTranscriptIdentity(
  result: Readonly<{ messages: readonly Message[] }>,
  messages: readonly Message[],
): void {
  if (result.messages[0] !== messages[0]) {
    throw new Error('direct media call mutated or replaced the canonical input message')
  }
}
