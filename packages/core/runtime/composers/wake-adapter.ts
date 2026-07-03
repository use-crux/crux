/**
 * Wake adapter contracts for stack-shaped runtime composers.
 *
 * Store adapters persist records; wake adapters deliver small signed envelopes
 * to a Runtime Engine HTTP entry or queue worker. The kernel still owns all
 * correctness, retries, leases, and idempotency.
 *
 * @module
 */

import type { RuntimeWakeRequestVerifier } from '../handler/verify'
import type { WakeEnvelope } from '../engine/envelope'
import type { RuntimeWakeDeliver } from '../engine/outbox'

/** Capabilities reported by a composable wake adapter. */
export interface RuntimeWakeAdapterCapabilities {
  /** Whether the adapter signs or otherwise authenticates HTTP wake requests. */
  readonly signed: boolean
  /** Maximum portable envelope bytes accepted by the wake substrate. */
  readonly maxPayloadBytes?: number
  /** Maximum native delay supported by this wake substrate. */
  readonly maxDelayMs?: number
}

/** Message handed to queue-style wake adapters. */
export interface RuntimeWakeMessage {
  /** Stable delivery id, derived from the envelope idempotency key. */
  readonly id: string
  /** Absolute HTTP endpoint that should receive this wake. */
  readonly url: string
  /** Structured wake envelope. */
  readonly envelope: WakeEnvelope
  /** Encoded wake envelope body. */
  readonly body: string
  /** Headers that a queue HTTP bridge should forward with the body. */
  readonly headers: Readonly<Record<string, string>>
}

/** Input used to materialize a wake delivery callback. */
export interface RuntimeWakeAdapterInput {
  /** Absolute HTTP endpoint that should receive runtime wakes. */
  readonly url: string
}

/** Composable wake adapter accepted by `serverless({ wake })`. */
export interface RuntimeWakeAdapter {
  /** Stable wake adapter id used in diagnostics. */
  readonly id: string
  /** Honest wake substrate capabilities. */
  readonly capabilities: RuntimeWakeAdapterCapabilities
  /** Optional HTTP request verifier for generated handlers. */
  readonly verify?: RuntimeWakeRequestVerifier
  /** Create a delivery callback for this deployment endpoint. */
  createWake(input: RuntimeWakeAdapterInput): RuntimeWakeDeliver
}
