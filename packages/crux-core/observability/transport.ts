import type { CruxGraphRecord } from './contract'
import { CruxGraphRecordBatchSchema } from './schema'

export interface CruxObservabilityTransport {
  send(records: readonly CruxGraphRecord[]): void | Promise<void>
}

export interface HttpObservabilityTransportOptions {
  /**
   * Base URL for the local Crux server.
   * @default 'http://localhost:4400'
   */
  serverUrl?: string
  /**
   * Ingest endpoint, relative to `serverUrl` unless absolute.
   * @default '/api/observability/records'
   */
  endpoint?: string
  /** Extra headers for auth or deployment-specific routing. */
  headers?: Record<string, string>
  /**
   * Abort an individual POST after this many milliseconds.
   * @default 5000
   */
  timeoutMs?: number
  /**
   * Retry failed POSTs before giving up. This protects local devtools from
   * transient tunnel/server hiccups that would otherwise drop terminal records.
   * @default 2
   */
  retryAttempts?: number
  /**
   * Initial retry delay in milliseconds. Retries use a small linear backoff.
   * @default 100
   */
  retryDelayMs?: number
  /**
   * Maximum number of records to send in a single HTTP request.
   * @default 50
   */
  maxRecordsPerRequest?: number
  /** Injectable fetch implementation for tests and non-standard runtimes. */
  fetch?: typeof globalThis.fetch
}

export interface InMemoryObservabilityTransport extends CruxObservabilityTransport {
  readonly records: CruxGraphRecord[]
  clear(): void
}

export function createInMemoryObservabilityTransport(): InMemoryObservabilityTransport {
  const records: CruxGraphRecord[] = []
  return {
    records,
    send(batch) {
      records.push(...batch)
    },
    clear() {
      records.length = 0
    },
  }
}

function normalizeServerUrl(serverUrl: string): string {
  if (serverUrl.startsWith('ws://')) return `http://${serverUrl.slice('ws://'.length)}`
  if (serverUrl.startsWith('wss://')) return `https://${serverUrl.slice('wss://'.length)}`
  return serverUrl
}

function joinUrl(serverUrl: string, endpoint: string): string {
  if (/^https?:\/\//u.test(endpoint)) return endpoint
  return `${normalizeServerUrl(serverUrl).replace(/\/+$/u, '')}/${endpoint.replace(/^\/+/u, '')}`
}

const MAX_PREVIEW_STRING_LENGTH = 64_000
const MAX_PREVIEW_ARRAY_LENGTH = 200
const MAX_PREVIEW_OBJECT_KEYS = 200
const MAX_PREVIEW_DEPTH = 8

function toJsonSafe(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'string' && value.length > MAX_PREVIEW_STRING_LENGTH) {
      return `${value.slice(0, MAX_PREVIEW_STRING_LENGTH)}...[truncated ${value.length - MAX_PREVIEW_STRING_LENGTH} chars]`
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined') return null
  if (typeof value === 'function') return `[Function${value.name ? `: ${value.name}` : ''}]`
  if (typeof value === 'symbol') return String(value)

  if (depth >= MAX_PREVIEW_DEPTH) return '[MaxDepth]'

  if (value instanceof Date) return value.toISOString()

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    try {
      if (Array.isArray(value)) {
        const items = value.slice(0, MAX_PREVIEW_ARRAY_LENGTH).map((item) => toJsonSafe(item, seen, depth + 1))
        if (value.length > MAX_PREVIEW_ARRAY_LENGTH) {
          items.push(`...[truncated ${value.length - MAX_PREVIEW_ARRAY_LENGTH} items]`)
        }
        return items
      }

      const output: Record<string, unknown> = {}
      const entries = Object.entries(value as Record<string, unknown>)
      for (const [key, entryValue] of entries.slice(0, MAX_PREVIEW_OBJECT_KEYS)) {
        output[key] = toJsonSafe(entryValue, seen, depth + 1)
      }
      if (entries.length > MAX_PREVIEW_OBJECT_KEYS) {
        output.__crux_truncated_keys = entries.length - MAX_PREVIEW_OBJECT_KEYS
      }
      return output
    } finally {
      seen.delete(value)
    }
  }

  return String(value)
}

function sanitizeRecords(records: readonly CruxGraphRecord[]): CruxGraphRecord[] {
  return records.map((record) => toJsonSafe(record) as CruxGraphRecord)
}

class CruxObservabilityHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'CruxObservabilityHttpError'
  }
}

export function createHttpObservabilityTransport(
  options: HttpObservabilityTransportOptions = {},
): CruxObservabilityTransport {
  const url = joinUrl(options.serverUrl ?? 'http://localhost:4400', options.endpoint ?? '/api/observability/records')
  const fetchImpl = options.fetch ?? globalThis.fetch
  const retryAttempts = Math.max(0, options.retryAttempts ?? 2)
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 100)
  const maxRecordsPerRequest = Math.max(1, options.maxRecordsPerRequest ?? 50)

  return {
    async send(records) {
      if (!fetchImpl) throw new Error('No fetch implementation available for Crux observability transport')

      const sanitizedRecords = sanitizeRecords(records)
      const chunks: CruxGraphRecord[][] = []
      for (let index = 0; index < sanitizedRecords.length; index += maxRecordsPerRequest) {
        chunks.push(sanitizedRecords.slice(index, index + maxRecordsPerRequest))
      }

      for (const chunk of chunks) {
        await postChunk(chunk)
      }

      async function postChunk(chunk: readonly CruxGraphRecord[]): Promise<void> {
        const body = CruxGraphRecordBatchSchema.parse({ records: chunk })
        const payload = JSON.stringify(body)
        let lastError: unknown

        for (let attempt = 0; attempt <= retryAttempts; attempt++) {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000)

          try {
            const response = await fetchImpl!(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Bypass-Tunnel-Reminder': 'true',
                ...options.headers,
              },
              body: payload,
              signal: controller.signal,
            })

            if (response.ok) return
            lastError = new CruxObservabilityHttpError(
              `Crux observability ingest failed with HTTP ${response.status}`,
              response.status,
            )
          } catch (error) {
            lastError = error
          } finally {
            clearTimeout(timeout)
          }

          if (attempt < retryAttempts) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)))
          }
        }

        if (
          chunk.length > 1 &&
          lastError instanceof CruxObservabilityHttpError &&
          lastError.status !== undefined &&
          [400, 413, 422].includes(lastError.status)
        ) {
          const isolatedErrors: unknown[] = []
          let deliveredRecords = 0
          for (const record of chunk) {
            try {
              await postChunk([record])
              deliveredRecords += 1
            } catch (error) {
              isolatedErrors.push(error)
            }
          }
          if (deliveredRecords > 0) {
            return
          }
          throw isolatedErrors[0] instanceof Error
            ? isolatedErrors[0]
            : new Error(`Crux observability ingest failed: ${String(isolatedErrors[0])}`)
        }

        throw lastError instanceof Error
          ? lastError
          : new Error(`Crux observability ingest failed: ${String(lastError)}`)
      }
    },
  }
}
