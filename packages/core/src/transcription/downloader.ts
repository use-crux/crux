import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request } from 'node:https'
import type { DataAsset } from '../asset/types'
import { validateAudioBytes } from './audio-validation'

/** Minimal response surface used by the secure downloader. */
export interface SecureAudioFetchResponse {
  readonly status: number
  readonly headers: Headers
  readonly body: AsyncIterable<Uint8Array> | null
}

/** A connection target pinned to one already-validated DNS answer. */
export interface AudioPinnedDispatcher {
  readonly address: string
}

/** Injectable network call used by deterministic downloader tests and hosts. */
export type SecureAudioFetch = (
  url: URL,
  init: Readonly<{
    signal: AbortSignal
    headers: Headers
    dispatcher: unknown
  }>,
) => Promise<SecureAudioFetchResponse>

/** Dependencies and hard bounds for the shared secure audio downloader. */
export interface SecureAudioDownloaderOptions {
  readonly fetch?: SecureAudioFetch
  readonly resolver?: (hostname: string) => Promise<readonly string[]>
  readonly dispatcher?: (target: Readonly<{ hostname: string; address: string }>) => unknown
  readonly clock?: Readonly<{
    setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>
    clearTimeout(handle: ReturnType<typeof setTimeout>): void
  }>
  readonly maxBytes?: number
  readonly timeoutMs?: number
  readonly maxRedirects?: number
}

/** Per-download request controls. Credentials are stripped on every redirect. */
export interface SecureAudioDownloadRequest {
  readonly signal?: AbortSignal
  readonly headers?: HeadersInit
}

/** Build the bounded HTTPS downloader shared by transcription adapters. */
export function createSecureAudioDownloader(options: SecureAudioDownloaderOptions = {}) {
  const fetch = options.fetch ?? pinnedHttpsFetch
  const resolver = options.resolver ?? resolveAll
  const makeDispatcher = options.dispatcher ?? ((target) => ({ address: target.address }))
  const clock = options.clock ?? { setTimeout, clearTimeout }
  const maxBytes = options.maxBytes ?? 25 * 1024 * 1024
  const timeoutMs = options.timeoutMs ?? 30_000
  const maxRedirects = options.maxRedirects ?? 3

  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new TypeError('Audio download maxBytes must be positive')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Audio download timeoutMs must be positive')
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) throw new TypeError('Audio download maxRedirects must be a non-negative integer')

  return async function download(url: URL, requestOptions: SecureAudioDownloadRequest = {}): Promise<DataAsset> {
    const controller = new AbortController()
    const abort = () => controller.abort(requestOptions.signal?.reason)
    requestOptions.signal?.addEventListener('abort', abort, { once: true })
    const timer = clock.setTimeout(() => controller.abort(new Error('Audio download timed out')), timeoutMs)
    try {
      let current = new URL(url.href)
      let headers = new Headers(requestOptions.headers)
      for (let redirects = 0; ; redirects += 1) {
        validateUrl(current)
        let addresses: readonly string[]
        try {
          addresses = await resolver(current.hostname)
        } catch {
          throw new Error('Audio host resolution failed')
        }
        if (addresses.length === 0) throw new Error('Audio host did not resolve to a public network address')
        for (const address of addresses) assertPublicAddress(address)
        const dispatcher = makeDispatcher({ hostname: current.hostname, address: addresses[0]! })
        let response: SecureAudioFetchResponse
        try {
          response = await fetch(current, { signal: controller.signal, headers, dispatcher })
        } catch (error) {
          if (controller.signal.aborted) throw controller.signal.reason ?? error
          throw new Error('Audio download failed')
        }
        if (isRedirect(response.status)) {
          if (redirects >= maxRedirects) throw new Error('Audio download exceeded redirect limit')
          const location = response.headers.get('location')
          if (!location) throw new Error('Audio download redirect is missing a location')
          await response.body?.[Symbol.asyncIterator]().return?.()
          try {
            current = new URL(location, current)
          } catch {
            throw new Error('Audio download redirect location is invalid')
          }
          headers = stripCredentials(headers)
          continue
        }
        if (response.status < 200 || response.status >= 300) throw new Error('Audio download returned an unsuccessful status')
        return await readAudioResponse(response, maxBytes, controller)
      }
    } finally {
      clock.clearTimeout(timer)
      requestOptions.signal?.removeEventListener('abort', abort)
    }
  }
}

/** Default shared secure downloader. */
export const downloadAudio = createSecureAudioDownloader()

async function readAudioResponse(
  response: SecureAudioFetchResponse,
  maxBytes: number,
  controller: AbortController,
): Promise<DataAsset> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    controller.abort()
    throw new Error('Audio download exceeds the byte limit')
  }
  if (!response.body) throw new Error('Audio download returned no body')
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > maxBytes) {
      controller.abort()
      throw new Error('Audio download exceeds the byte limit')
    }
    chunks.push(chunk.slice())
  }
  const data = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  const mediaType = validateAudioBytes(data, response.headers.get('content-type') ?? undefined)
  return { type: 'data', data, mediaType, size }
}

function validateUrl(url: URL): void {
  if (url.protocol !== 'https:') throw new Error('Audio download requires HTTPS')
  if (url.username || url.password) throw new Error('Audio download URL must not contain userinfo')
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function stripCredentials(headers: Headers): Headers {
  const next = new Headers(headers)
  for (const name of ['authorization', 'proxy-authorization', 'cookie']) next.delete(name)
  return next
}

async function resolveAll(hostname: string): Promise<readonly string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address)
}

function assertPublicAddress(address: string): void {
  const version = isIP(address)
  if (version === 4 ? unsafeIpv4(address) : version === 6 ? unsafeIpv6(address) : true) {
    throw new Error('Audio host must resolve only to public network addresses')
  }
}

function unsafeIpv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a! >= 224 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
}

function unsafeIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address)
  if (!bytes) return true
  const allZero = bytes.every((byte) => byte === 0)
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1
  const mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff
  if (mapped) return unsafeIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`)
  const first = (bytes[0]! << 8) | bytes[1]!
  const second = (bytes[2]! << 8) | bytes[3]!
  return allZero || loopback || (bytes[0]! & 0xfe) === 0xfc || bytes[0] === 0xff ||
    (first & 0xffc0) === 0xfe80 ||
    (first === 0x0100 && bytes.slice(2, 8).every((byte) => byte === 0)) ||
    (first === 0x2001 && second < 0x0200) ||
    (first === 0x2001 && second === 0x0db8) ||
    (first & 0xfff0) === 0x3ff0
}

function ipv6Bytes(address: string): Uint8Array | undefined {
  const [head = '', tail = ''] = address.toLowerCase().split('::')
  if (address.split('::').length > 2) return undefined
  const left = ipv6Words(head)
  const right = ipv6Words(tail)
  if (!left || !right) return undefined
  const missing = 8 - left.length - right.length
  if ((!address.includes('::') && missing !== 0) || missing < 0) return undefined
  const words = [...left, ...Array<number>(missing).fill(0), ...right]
  const bytes = new Uint8Array(16)
  words.forEach((word, index) => { bytes[index * 2] = word >> 8; bytes[index * 2 + 1] = word & 0xff })
  return bytes
}

function ipv6Words(value: string): number[] | undefined {
  if (!value) return []
  const parts = value.split(':')
  const last = parts.at(-1)
  if (last?.includes('.')) {
    const octets = last.split('.').map(Number)
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return undefined
    parts.splice(-1, 1, ((octets[0]! << 8) | octets[1]!).toString(16), ((octets[2]! << 8) | octets[3]!).toString(16))
  }
  const words = parts.map((part) => /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : Number.NaN)
  return words.some(Number.isNaN) ? undefined : words
}

async function pinnedHttpsFetch(
  url: URL,
  init: Readonly<{ signal: AbortSignal; headers: Headers; dispatcher: unknown }>,
): Promise<SecureAudioFetchResponse> {
  const pinned = init.dispatcher as Partial<AudioPinnedDispatcher>
  if (!pinned.address) throw new Error('Audio download connection was not pinned')
  return await new Promise((resolve, reject) => {
    const req = request({
      protocol: 'https:',
      hostname: url.hostname,
      servername: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: headersRecord(init.headers),
      lookup: (_hostname, _options, callback) => callback(null, pinned.address!, isIP(pinned.address!) as 4 | 6),
      signal: init.signal,
    }, (response) => {
      const headers = new Headers()
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item)
        else if (value !== undefined) headers.set(name, String(value))
      }
      resolve({ status: response.statusCode ?? 0, headers, body: response })
    })
    req.on('error', reject)
    req.end()
  })
}

function headersRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, name) => { result[name] = value })
  return result
}
