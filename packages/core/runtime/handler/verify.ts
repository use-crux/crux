/**
 * HTTP wake request verification contracts.
 *
 * Verification receives the raw request body before the handler decodes the
 * wake envelope. This keeps signature checks ahead of every durable runtime
 * write, including malformed or tampered payloads.
 *
 * @module
 */

import { createRuntimeError } from '../engine/errors'

/** Header carrying Crux custom wake HMAC signatures. */
export const CRUX_WAKE_SIGNATURE_HEADER = 'x-crux-signature'

const HMAC_SHA256_PREFIX = 'sha256='
const HMAC_SHA256_HEX_LENGTH = 64
const MIN_WAKE_SECRET_LENGTH = 16

/** Data available to HTTP wake request verifiers. */
export interface RuntimeWakeVerificationInput {
  /** Incoming fetch-compatible request. */
  readonly request: Request
  /** Raw request body text used by verifiers such as QStash. */
  readonly body: string
  /** Raw request body bytes, before any JSON parse or re-serialization. */
  readonly rawBody: Uint8Array
}

/** Pluggable verification callback for signed HTTP wake requests. */
export type RuntimeWakeRequestVerifier = (
  input: RuntimeWakeVerificationInput,
) => boolean | Promise<boolean>

/** Development verifier that accepts every request. */
export const allowUnsignedDevWake: RuntimeWakeRequestVerifier = () => true

/** Options for {@link hmacWakeVerifier}. */
export interface HmacWakeVerifierOptions {
  /** Shared wake signing secret. Must be at least 16 characters. */
  readonly secret: string
}

/**
 * Create a verifier for custom HTTP wake HMAC signatures.
 *
 * The v1 wire format is:
 *
 * ```txt
 * x-crux-signature: sha256=<lowercase-hex HMAC-SHA256(raw request body)>
 * ```
 *
 * No timestamp is part of the signature. Runtime wake messages may be delayed
 * for timers or backoff, and replay is handled by durable idempotency.
 */
export function hmacWakeVerifier(
  options: HmacWakeVerifierOptions,
): RuntimeWakeRequestVerifier {
  assertWakeSecret(options.secret)
  return ({ request, rawBody }) =>
    verifyWakeSignature({
      signature: request.headers.get(CRUX_WAKE_SIGNATURE_HEADER),
      body: rawBody,
      secret: options.secret,
    })
}

/** Sign an encoded wake body for custom HTTP wake delivery. */
export async function signWakeBody(
  body: string | Uint8Array,
  secret: string,
): Promise<string> {
  assertWakeSecret(secret)
  return `${HMAC_SHA256_PREFIX}${bytesToHex(await hmacSha256(body, secret))}`
}

/** Generate an ephemeral development wake secret. */
export function devWakeSecret(): string {
  const bytes = new Uint8Array(32)
  webCrypto().getRandomValues(bytes)
  return bytesToHex(bytes)
}

/** Validate the minimum custom wake secret length. */
export function assertWakeSecret(secret: string): void {
  if (secret.length >= MIN_WAKE_SECRET_LENGTH) return
  throw createRuntimeError({
    code: 'WAKE_UNVERIFIED',
    whatFailed: 'Runtime wake signing secret is too short.',
    why: 'Custom HTTP wake signatures require a shared secret with at least 16 characters.',
    whatStillWorks:
      'Unsigned local-only wake delivery can still be used in development.',
    nextStep:
      'Use a random CRUX_RUNTIME_WAKE_SECRET with at least 32 bytes of entropy.',
  })
}

async function verifyWakeSignature(options: {
  readonly signature: string | null
  readonly body: Uint8Array
  readonly secret: string
}): Promise<boolean> {
  const signature = options.signature
  if (!signature?.startsWith(HMAC_SHA256_PREFIX)) return false
  const hex = signature.slice(HMAC_SHA256_PREFIX.length)
  if (!/^[0-9a-f]+$/.test(hex)) {
    return false
  }
  if (hex.length !== HMAC_SHA256_HEX_LENGTH) {
    constantTimeEqual(new Uint8Array(32), new Uint8Array(32))
    return false
  }

  const provided = bytesFromHex(hex)
  const expected = await hmacSha256(options.body, options.secret)
  return constantTimeEqual(provided, expected)
}

async function hmacSha256(
  body: string | Uint8Array,
  secret: string,
): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const key = await webCrypto().subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await webCrypto().subtle.sign(
    'HMAC',
    key,
    bodyToArrayBuffer(body),
  )
  return new Uint8Array(signature)
}

function bodyToArrayBuffer(body: string | Uint8Array): ArrayBuffer {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

function bytesFromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function webCrypto() {
  const crypto = globalThis.crypto
  if (crypto?.subtle && typeof crypto.getRandomValues === 'function') {
    return crypto
  }
  throw createRuntimeError({
    code: 'WAKE_UNVERIFIED',
    whatFailed: 'WebCrypto is unavailable for Runtime Engine wake signing.',
    why: 'Crux custom wake signatures use platform-neutral HMAC-SHA256 through globalThis.crypto.',
    whatStillWorks:
      'Runtime adapters that do not require custom HTTP wake signing can still run.',
    nextStep:
      'Run Crux on a WebCrypto-capable runtime or configure a host-native wake adapter such as Convex or QStash.',
  })
}
