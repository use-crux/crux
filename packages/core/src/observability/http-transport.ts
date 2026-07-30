import type { CruxGraphRecord } from './contract'
import { serializeDeliveryEnvelope } from './delivery/bytes'
import {
  acceptedDeliveryReceipt,
  rejectedDeliveryReceipt,
  type CruxDeliveryAttemptContext,
  type CruxDeliveryReceipt,
} from './delivery/receipt'
import type { CruxObservabilityTransport } from './transport'
import { submitHttpFeedback } from '../feedback/http-destination'
import { createHttpEvidenceDestination } from './http-evidence-destination'

const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024
const MAX_RECEIPT_MESSAGE_LENGTH = 240

export interface HttpObservabilityTransportOptions {
  /** Base URL for the local Crux server. @default 'http://localhost:4400' */
  serverUrl?: string
  /** Ingest endpoint relative to `serverUrl`. @default '/api/observability/records' */
  endpoint?: string
  /** Bearer token for scoped observability ingest auth. */
  token?: string
  /** Evidence inspection endpoint relative to `serverUrl`. */
  evidenceEndpoint?: string
  /** Feedback endpoint relative to `serverUrl`. @default '/api/feedback' */
  feedbackEndpoint?: string
  /** Optional write-only feedback token; defaults to the ingest token. */
  feedbackToken?: string
  /** Allowlisted extra headers for local routing. */
  headers?: Record<string, string>
  /** Abort one POST after this duration. @default 5000 */
  timeoutMs?: number
  /** Maximum records in one HTTP request. @default 50 */
  maxRecordsPerRequest?: number
  /** Maximum exact UTF-8 request payload bytes. @default 1048576 */
  maxRequestBytes?: number
  /** Injectable fetch implementation. */
  fetch?: typeof globalThis.fetch
}

/** Create the receipt-aware v2 HTTP transport used by local DevTools. */
export function createHttpObservabilityTransport(
  options: HttpObservabilityTransportOptions = {},
): CruxObservabilityTransport {
  const url = joinUrl(
    options.serverUrl ?? 'http://localhost:4400',
    options.endpoint ?? '/api/observability/records',
  )
  const feedbackUrl = joinUrl(
    options.serverUrl ?? 'http://localhost:4400',
    options.feedbackEndpoint ?? '/api/feedback',
  )
  const evidenceUrl = joinUrl(
    options.serverUrl ?? 'http://localhost:4400',
    options.evidenceEndpoint ?? '/api/observability/evidence/inspect',
  )
  const fetchImpl = options.fetch ?? globalThis.fetch
  const maxRecordsPerRequest = positiveInteger(options.maxRecordsPerRequest, 50)
  const maxRequestBytes = positiveInteger(
    options.maxRequestBytes,
    DEFAULT_MAX_REQUEST_BYTES,
  )
  const token = normalizeToken(options.token) ?? defaultDevtoolsToken()
  const feedbackToken = normalizeToken(options.feedbackToken) ?? token
  return {
    maxRecordsPerRequest,
    maxRequestBytes,
    evidence: createHttpEvidenceDestination({
      url: evidenceUrl,
      // Local evidence reads use the same-user loopback or browser session
      // boundary. The ingest-only bearer must never be reused for inspection.
      headers: requestHeaders(undefined, options.headers),
      timeoutMs: options.timeoutMs ?? 5000,
      fetchImpl,
    }),
    async send(records, context) {
      if (!fetchImpl) throw new Error('Observability transport is unavailable')
      const payload = serializeDeliveryEnvelope(records, context)
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? 5000,
      )
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: requestHeaders(token, options.headers),
          body: payload,
          signal: controller.signal,
        })
        const retryAfter = parseRetryAfter(response.headers.get('Retry-After'))
        const decoded = await decodeJson(response)
        if (isObject(decoded) && Array.isArray(decoded.dispositions)) {
          return parseReceipt(decoded, records, retryAfter)
        }
        if (response.ok) return parseReceipt(decoded, records, retryAfter)
        return rejectedDeliveryReceipt(records, {
          code: httpCode(response.status),
          message: isRetryableStatus(response.status)
            ? 'observability delivery is temporarily unavailable'
            : 'observability request was permanently rejected',
          retryable: isRetryableStatus(response.status),
          ...(retryAfter > 0 ? { retryAfterMs: retryAfter } : {}),
        })
      } catch {
        throw new Error('Observability request failed')
      } finally {
        clearTimeout(timeout)
      }
    },
    async submitFeedback(submission) {
      if (!fetchImpl) throw new Error('Feedback destination is unavailable')
      return submitHttpFeedback({
        fetchImpl,
        url: feedbackUrl,
        headers: requestHeaders(feedbackToken, options.headers),
        timeoutMs: options.timeoutMs ?? 5000,
        submission,
      })
    },
  }
}

function parseReceipt(
  value: unknown,
  records: readonly CruxGraphRecord[],
  retryAfterMs: number,
): CruxDeliveryReceipt {
  if (isObject(value) && Array.isArray(value.dispositions)) {
    return {
      dispositions: value.dispositions
        .map(sanitizeDisposition)
        .filter((item) => item !== undefined),
      ...(retryAfterMs > 0 ? { retryAfterMs } : {}),
    }
  }
  if (
    isObject(value) &&
    Number.isInteger(value.accepted) &&
    Array.isArray(value.rejected)
  ) {
    const complete =
      value.accepted === records.length && value.rejected.length === 0
    return complete
      ? acceptedDeliveryReceipt(records)
      : rejectedDeliveryReceipt(records, {
          code: 'count_only_partial',
          message: 'count-only receipt did not account for the complete batch',
          retryable: true,
          ...(retryAfterMs > 0 ? { retryAfterMs } : {}),
        })
  }
  return { dispositions: [], ...(retryAfterMs > 0 ? { retryAfterMs } : {}) }
}

function sanitizeDisposition(
  value: unknown,
): CruxDeliveryReceipt['dispositions'][number] | undefined {
  if (!isObject(value)) return undefined
  if (typeof value.index !== 'number' || typeof value.recordId !== 'string')
    return undefined
  if (value.outcome !== 'accepted' && value.outcome !== 'rejected')
    return undefined
  if (typeof value.code !== 'string' || typeof value.retryable !== 'boolean')
    return undefined
  if (value.outcome === 'accepted' && value.retryable !== false)
    return undefined
  const base = {
    index: value.index,
    recordId:
      value.recordId as CruxDeliveryReceipt['dispositions'][number]['recordId'],
    code: sanitizeCode(value.code),
    ...(typeof value.message === 'string'
      ? { message: sanitizeMessage(value.message) }
      : {}),
  }
  return value.outcome === 'accepted'
    ? { ...base, outcome: 'accepted', retryable: false }
    : { ...base, outcome: 'rejected', retryable: value.retryable }
}

function requestHeaders(
  token: string | undefined,
  extra: Record<string, string> | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Bypass-Tunnel-Reminder': 'true',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  for (const [name, value] of Object.entries(extra ?? {})) {
    if (isAllowlistedHeader(name)) headers[name] = value
  }
  return headers
}

function isAllowlistedHeader(name: string): boolean {
  const normalized = name.toLowerCase()
  return (
    normalized === 'bypass-tunnel-reminder' || normalized.startsWith('x-crux-')
  )
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 0
  const seconds = Number(value)
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now()
  return Math.max(0, Number.isFinite(delay) ? Math.round(delay) : 0)
}

async function decodeJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text())
  } catch {
    return undefined
  }
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  )
}

function httpCode(status: number | undefined): string {
  return status === undefined ? 'transport_unavailable' : `http_${status}`
}

function sanitizeCode(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/gu, '_')
    .slice(0, 80)
  return safe || 'unknown'
}

function sanitizeMessage(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gu, '[url]')
    .replace(/bearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/[\r\n]+/gu, ' ')
    .slice(0, MAX_RECEIPT_MESSAGE_LENGTH)
}

function normalizeServerUrl(serverUrl: string): string {
  if (serverUrl.startsWith('ws://')) return `http://${serverUrl.slice(5)}`
  if (serverUrl.startsWith('wss://')) return `https://${serverUrl.slice(6)}`
  return serverUrl
}

function joinUrl(serverUrl: string, endpoint: string): string {
  if (/^https?:\/\//u.test(endpoint)) return endpoint
  const base = new URL(normalizeServerUrl(serverUrl))
  const path = `${base.pathname.replace(/\/+$/u, '')}/${endpoint.replace(/^\/+/u, '')}`
  const joined = new URL(path, base.origin)
  if (!joined.search) joined.search = base.search
  return joined.toString()
}

function normalizeToken(token: string | undefined): string | undefined {
  const trimmed = token?.trim()
  return trimmed || undefined
}

function defaultDevtoolsToken(): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Readonly<Record<string, string | undefined>> }
  }
  return normalizeToken(runtime.process?.env?.CRUX_DEVTOOLS_TOKEN)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.trunc(Number.isFinite(value) ? value! : fallback))
}
