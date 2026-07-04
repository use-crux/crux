import type { CruxGraphRecord } from './contract'

export interface CruxObservabilityTransport {
  /**
   * Deliver a batch of canonical graph records.
   *
   * The delivery engine may call this with records that were delivered in an
   * earlier attempt. Implementations must therefore be idempotent by
   * `recordId`. The engine does not call a single delivery attempt
   * re-entrantly.
   */
  send(records: readonly CruxGraphRecord[]): void | Promise<void>
  /**
   * Maximum records the engine should pass to one `send()` call for this
   * transport. Defaults to 50 when omitted.
   */
  maxRecordsPerRequest?: number
  /**
   * Drain transport-owned buffers. Called after the engine drains queued and
   * in-flight records from `observe.flush()`.
   */
  flush?(): Promise<void>
  /**
   * Final drain and resource release. Called from `observe.shutdown()` after
   * queued records have been flushed.
   */
  shutdown?(): Promise<void>
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
  /**
   * Bearer token for scoped observability ingest auth.
   *
   * This authenticates writes to a local devtools ingest endpoint without
   * granting access to the full devtools session.
   */
  token?: string
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
  const base = new URL(normalizeServerUrl(serverUrl))
  const basePath = base.pathname.replace(/\/+$/u, '')
  const endpointUrl = new URL(`${basePath}/${endpoint.replace(/^\/+/u, '')}`, base.origin)
  if (!endpointUrl.search) endpointUrl.search = base.search
  return endpointUrl.toString()
}

function normalizeToken(token: string | undefined): string | undefined {
  const trimmed = token?.trim()
  return trimmed ? trimmed : undefined
}

type ProcessEnvLike = Readonly<Record<string, string | undefined>>

function defaultDevtoolsToken(): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: ProcessEnvLike }
  }
  return normalizeToken(runtime.process?.env?.CRUX_DEVTOOLS_TOKEN)
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

/**
 * Reports poison records found by per-record HTTP isolation.
 *
 * Delivery treats these failed isolated records as permanently dropped and
 * continues with later chunks, while preserving at-least-once retry behavior
 * for ordinary transport failures.
 */
export class CruxObservabilityIngestError extends Error {
  readonly delivered: number
  readonly failed: number
  readonly firstError: unknown

  constructor(options: { delivered: number; failed: number; firstError: unknown }) {
    super(`Crux observability ingest isolated ${options.failed} rejected record(s)`)
    this.name = 'CruxObservabilityIngestError'
    this.delivered = options.delivered
    this.failed = options.failed
    this.firstError = options.firstError
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
  const token = normalizeToken(options.token) ?? defaultDevtoolsToken()
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined

  return {
    maxRecordsPerRequest,
    async send(records) {
      if (!fetchImpl) throw new Error('No fetch implementation available for Crux observability transport')
      await postChunk(records)

      async function postChunk(chunk: readonly CruxGraphRecord[]): Promise<void> {
        const payload = JSON.stringify({ records: chunk })
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
                ...authHeaders,
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
          throw new CruxObservabilityIngestError({
            delivered: deliveredRecords,
            failed: isolatedErrors.length,
            firstError: isolatedErrors[0],
          })
        }

        throw lastError instanceof Error
          ? lastError
          : new Error(`Crux observability ingest failed: ${String(lastError)}`)
      }
    },
  }
}
