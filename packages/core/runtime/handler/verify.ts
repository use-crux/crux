/**
 * HTTP wake request verification contracts.
 *
 * Verification receives the raw request body before the handler decodes the
 * wake envelope. This keeps signature checks ahead of every durable runtime
 * write, including malformed or tampered payloads.
 *
 * @module
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
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
export function signWakeBody(
  body: string | Uint8Array,
  secret: string,
): string {
  assertWakeSecret(secret)
  return `${HMAC_SHA256_PREFIX}${hmacSha256Hex(body, secret)}`
}

/** Generate an ephemeral development wake secret. */
export function devWakeSecret(): string {
  return randomBytes(32).toString('hex')
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

function verifyWakeSignature(options: {
  readonly signature: string | null
  readonly body: Uint8Array
  readonly secret: string
}): boolean {
  const signature = options.signature
  if (!signature?.startsWith(HMAC_SHA256_PREFIX)) return false
  const hex = signature.slice(HMAC_SHA256_PREFIX.length)
  if (!/^[0-9a-f]+$/.test(hex) || hex.length !== HMAC_SHA256_HEX_LENGTH) {
    return false
  }

  const provided = Buffer.from(hex, 'hex')
  const expected = Buffer.from(hmacSha256Hex(options.body, options.secret), 'hex')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function hmacSha256Hex(body: string | Uint8Array, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}
