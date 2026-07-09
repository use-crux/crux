/**
 * `@use-crux/upstash/runtime` — QStash Runtime Engine wake adapter.
 *
 * QStash is the first-party HTTP wake substrate for serverless Crux runtimes.
 * It publishes small wake envelopes to the configured runtime endpoint and
 * verifies incoming QStash signatures with the official `@upstash/qstash`
 * `Receiver`.
 *
 * @module
 */

import { Client, Receiver } from '@upstash/qstash'
import {
  MAX_WAKE_ENVELOPE_BYTES,
  type RuntimeWakeAdapter,
  type RuntimeWakeAdapterInput,
  type RuntimeWakeVerificationInput,
  type WakeEnvelope,
} from '@use-crux/core/runtime'

const DEFAULT_QSTASH_MAX_DELAY_MS = 7 * 24 * 60 * 60 * 1_000

/** Publish request shape Crux sends through QStash. */
export interface QStashPublishRequest {
  /** Runtime endpoint that should receive the wake. */
  readonly url: string
  /** Wake envelope body; QStash serializes this as JSON. */
  readonly body: WakeEnvelope
  /** QStash delivery de-duplication id. */
  readonly deduplicationId: string
  /** Optional QStash retry count. */
  readonly retries?: number
}

/** Minimal QStash client surface used by the runtime adapter. */
export interface QStashRuntimeClient {
  /** Publish one JSON wake message to QStash. */
  publishJSON(request: QStashPublishRequest): Promise<unknown>
}

/** Verification request passed to the official QStash receiver. */
export interface QStashVerifyRequest {
  /** Raw `Upstash-Signature` header value. */
  readonly signature: string
  /** Raw request body text. */
  readonly body: string
  /** Absolute endpoint URL QStash called. */
  readonly url?: string
  /** Optional Upstash region header for multi-region signing keys. */
  readonly upstashRegion?: string
}

/** Minimal official receiver surface used by the runtime adapter. */
export interface QStashRuntimeReceiver {
  /** Verify one incoming QStash request. */
  verify(request: QStashVerifyRequest): Promise<boolean>
}

/** Options accepted by {@link qstash}. */
export interface QStashRuntimeOptions {
  /** QStash token. Defaults to `QSTASH_TOKEN` through the official SDK. */
  readonly token?: string
  /** Injected QStash client for tests or custom SDK construction. */
  readonly client?: QStashRuntimeClient
  /** Current signing key. Defaults to SDK environment inference. */
  readonly currentSigningKey?: string
  /** Next signing key for rotation. Defaults to SDK environment inference. */
  readonly nextSigningKey?: string
  /** Injected receiver for tests or custom verification. */
  readonly receiver?: QStashRuntimeReceiver
  /** QStash retry count for runtime wake deliveries. */
  readonly retries?: number
  /** Honest maximum native QStash delay for this account/plan. Defaults to 7 days. */
  readonly maxDelayMs?: number
}

/**
 * Create a QStash wake adapter for `serverless({ wake: qstash() })`.
 *
 * The adapter publishes each wake with the envelope idempotency key as the
 * QStash `deduplicationId`, and verifies incoming requests using the official
 * `Receiver` against the `Upstash-Signature` header.
 */
export function qstash(options: QStashRuntimeOptions = {}): RuntimeWakeAdapter {
  const client =
    options.client ??
    new Client({ ...(options.token ? { token: options.token } : {}) })
  const receiver =
    options.receiver ??
    new Receiver({
      ...(options.currentSigningKey
        ? { currentSigningKey: options.currentSigningKey }
        : {}),
      ...(options.nextSigningKey
        ? { nextSigningKey: options.nextSigningKey }
        : {}),
    })

  return Object.freeze({
    id: 'qstash',
    capabilities: Object.freeze({
      signed: true,
      maxPayloadBytes: MAX_WAKE_ENVELOPE_BYTES,
      maxDelayMs: options.maxDelayMs ?? DEFAULT_QSTASH_MAX_DELAY_MS,
    }),
    async verify({ request, body }: RuntimeWakeVerificationInput) {
      const signature = request.headers.get('upstash-signature')
      if (!signature) return false
      const upstashRegion = request.headers.get('upstash-region')
      try {
        return await receiver.verify({
          signature,
          body,
          url: request.url,
          ...(upstashRegion ? { upstashRegion } : {}),
        })
      } catch {
        return false
      }
    },
    createWake({ url }: RuntimeWakeAdapterInput) {
      return async (envelope: WakeEnvelope) => {
        await client.publishJSON({
          url,
          body: envelope,
          deduplicationId: envelope.idempotencyKey,
          ...(options.retries !== undefined ? { retries: options.retries } : {}),
        })
      }
    },
  })
}
