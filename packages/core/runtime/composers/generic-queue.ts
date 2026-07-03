/**
 * Generic queue wake adapter.
 *
 * `genericQueue()` is the dependency-free escape hatch for queues Crux does
 * not bundle. It turns kernel wake envelopes into small messages users can add
 * to BullMQ, SQS, RabbitMQ, or any queue that can later POST or handle them.
 *
 * @module
 */

import { MAX_WAKE_ENVELOPE_BYTES, encodeWakeEnvelope } from '../engine/envelope'
import type { WakeEnvelope } from '../engine/envelope'
import {
  CRUX_WAKE_SIGNATURE_HEADER,
  assertWakeSecret,
  devWakeSecret,
  hmacWakeVerifier,
  signWakeBody,
} from '../handler/verify'
import type {
  RuntimeWakeAdapter,
  RuntimeWakeAdapterInput,
  RuntimeWakeMessage,
} from './wake-adapter'

/** Options accepted by {@link genericQueue}. */
export interface GenericQueueWakeOptions {
  /** Enqueue one wake message durably. */
  enqueue(message: RuntimeWakeMessage): Promise<void> | void
  /**
   * Shared secret used to sign custom HTTP wake requests.
   *
   * Secrets shorter than 16 characters throw at construction time. Prefer at
   * least 32 random bytes, supplied from environment such as
   * `CRUX_RUNTIME_WAKE_SECRET`.
   */
  readonly secret?: string
  /**
   * Generate an ephemeral signing secret for local development.
   *
   * This keeps custom queue bridges authenticated while avoiding committed dev
   * secrets. The secret changes on process restart, so it is not suitable for
   * production or long-delayed queued messages.
   */
  readonly devSecret?: boolean
  /** Optional sink for the loud dev-secret warning. Defaults to `console.warn`. */
  readonly onDevSecretWarning?: (message: string) => void
  /** Maximum native delay supported by the queue, when known. */
  readonly maxDelayMs?: number
}

/**
 * Create a dependency-free queue wake adapter.
 *
 * The queue callback receives the absolute runtime endpoint, encoded body, and
 * structured envelope. The application owns the actual queue worker and any
 * HTTP bridge it chooses to expose.
 */
export function genericQueue(
  options: GenericQueueWakeOptions,
): RuntimeWakeAdapter {
  const secret = resolveWakeSecret(options)
  return Object.freeze({
    id: 'generic-queue',
    capabilities: Object.freeze({
      signed: Boolean(secret),
      maxPayloadBytes: MAX_WAKE_ENVELOPE_BYTES,
      ...(options.maxDelayMs ? { maxDelayMs: options.maxDelayMs } : {}),
    }),
    ...(secret ? { verify: hmacWakeVerifier({ secret }) } : {}),
    createWake({ url }: RuntimeWakeAdapterInput) {
      return async (envelope: WakeEnvelope) => {
        const body = encodeWakeEnvelope(envelope)
        await options.enqueue({
          id: envelope.idempotencyKey,
          url,
          envelope,
          body,
          headers: secret
            ? { [CRUX_WAKE_SIGNATURE_HEADER]: signWakeBody(body, secret) }
            : {},
        })
      }
    },
  })
}

function resolveWakeSecret(
  options: GenericQueueWakeOptions,
): string | undefined {
  if (options.secret !== undefined) {
    assertWakeSecret(options.secret)
    return options.secret
  }
  if (!options.devSecret) return undefined

  const secret = devWakeSecret()
  const warning =
    'Crux generated an ephemeral development wake secret for genericQueue(); queued wake messages signed before a process restart will no longer verify.'
  if (options.onDevSecretWarning) options.onDevSecretWarning(warning)
  else if (typeof console !== 'undefined') console.warn(warning)
  return secret
}
