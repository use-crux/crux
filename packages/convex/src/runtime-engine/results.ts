import type { JsonValue } from '@use-crux/core/storage'
import {
  RUNTIME_RESULT_MEDIA_TYPE,
  type RuntimePruneResult,
  type RuntimeResultPayloadPort,
  type RuntimeResultRef,
} from '@use-crux/core/runtime'
import { canonicalRuntimeResult, createRuntimeResultLocation } from '@use-crux/core/runtime/internal/eval-host'

const RESULT_CHUNK_BYTES = 192 * 1024

/** Component references required by Convex Runtime result storage. */
export interface ConvexRuntimeResultComponent {
  readonly put: unknown
  readonly get: unknown
  readonly deleteResult: unknown
  readonly pruneUnreferenced: unknown
}

/** Create chunked, content-addressed Runtime result storage over component mutations. */
export function createConvexRuntimeResultStore(options: {
  readonly refs: ConvexRuntimeResultComponent
  readonly run: <TResult>(ref: unknown, args: Record<string, unknown>) => Promise<TResult>
  readonly now: () => Date
}): RuntimeResultPayloadPort {
  const store: RuntimeResultPayloadPort = {
    async put(payload, putOptions): Promise<RuntimeResultRef> {
      const canonical = canonicalRuntimeResult(payload)
      const location = createRuntimeResultLocation('convex', putOptions.namespace, canonical.sha256)
      const chunks = chunkBytes(canonical.bytes).map(encodeBase64)
      await options.run(options.refs.put, {
        namespace: putOptions.namespace,
        sha256: canonical.sha256,
        size: canonical.bytes.byteLength,
        mediaType: RUNTIME_RESULT_MEDIA_TYPE,
        location,
        chunks,
        createdAt: options.now().getTime(),
      })
      return Object.freeze({
        sha256: canonical.sha256,
        size: canonical.bytes.byteLength,
        mediaType: RUNTIME_RESULT_MEDIA_TYPE,
        location,
      })
    },
    async get(ref): Promise<JsonValue | null> {
      const stored = await options.run<StoredResult | null>(options.refs.get, {
        location: ref.location,
      })
      if (stored === null) return null
      const bytes = concatenate(stored.chunks.map(decodeBase64))
      const payload = JSON.parse(new TextDecoder().decode(bytes)) as JsonValue
      const canonical = canonicalRuntimeResult(payload)
      if (
        stored.location !== ref.location ||
        stored.sha256 !== ref.sha256 ||
        stored.size !== ref.size ||
        stored.mediaType !== ref.mediaType ||
        canonical.sha256 !== ref.sha256 ||
        canonical.bytes.byteLength !== ref.size
      ) {
        throw new TypeError('Runtime result payload failed content-integrity verification.')
      }
      return payload
    },
    delete: (ref) => {
      assertConvexResultLocation(ref)
      return options.run(options.refs.deleteResult, { ref }).then(noop)
    },
    pruneUnreferenced: (pruneOptions) =>
      options.run<RuntimePruneResult>(options.refs.pruneUnreferenced, {
        ...pruneOptions,
        before: pruneOptions.before.getTime(),
      }),
  }
  return Object.freeze(store)
}

interface StoredResult {
  readonly sha256: string
  readonly size: number
  readonly mediaType: string
  readonly location: string
  readonly chunks: readonly string[]
}

function chunkBytes(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += RESULT_CHUNK_BYTES) {
    chunks.push(bytes.slice(offset, offset + RESULT_CHUNK_BYTES))
  }
  return chunks
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.byteLength; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192))
  }
  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function noop(): void {}

function assertConvexResultLocation(ref: RuntimeResultRef): void {
  if (!ref.location.startsWith('convex:') || !ref.location.endsWith(`:sha256:${ref.sha256}`)) {
    throw new TypeError('Runtime result reference has an invalid Convex location.')
  }
}
