/**
 * `@use-crux/ai/stream` — AI SDK stream integration for Crux plans and task lists.
 *
 * **Server:** `createCruxStreamWriter()` subscribes to CruxStore changes and
 * injects `data-crux` parts into an active AI SDK UIMessageStream.
 *
 * **Client:** `createStreamTransport()` accumulates stream data parts and
 * exposes them as a `CruxTransport` for reactive hooks.
 *
 * @module
 */

// Server
export { createCruxStreamWriter } from './server'

// Client
export { createStreamTransport } from './client'
export type { StreamTransport } from './client'

// Types
export type { CruxDataPart, CruxStreamChunk } from './types'
