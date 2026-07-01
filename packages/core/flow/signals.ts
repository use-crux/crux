/**
 * Flow signal declaration helpers.
 *
 * Local signal maps let a flow name the external signals it accepts once, then
 * reuse that contract for `flow.suspend()` and `handle.signal()` inference.
 *
 * @module
 */

import type { JsonValue } from '../storage'
import type { ZodError, ZodType } from 'zod'

const NO_PAYLOAD_SIGNAL_TAG = 'crux.flow.no_payload' as const

/**
 * Marker returned by {@link noPayload}.
 *
 * Use it for signals that are pure notifications and should not accept a
 * payload at `handle.signal()` call sites.
 */
export interface NoPayloadSignal {
  readonly _tag: typeof NO_PAYLOAD_SIGNAL_TAG
}

/** Schema-like declaration for one local flow signal. */
export type FlowSignalSpec<TPayload = unknown> = ZodType<TPayload> | NoPayloadSignal

/** Local signal declarations keyed by the signal name used in `suspend()`. */
export type FlowSignalMap = Record<string, FlowSignalSpec>

/** Definition-time options accepted by `flow(name, options, handler)`. */
export interface FlowDefinitionOptions<TSignals extends FlowSignalMap = FlowSignalMap> {
  /** Local signal contracts shared by `flow.suspend()` and `handle.signal()`. */
  readonly signals: TSignals
}

/** Infer the payload delivered by a signal declaration. */
export type FlowSignalPayload<TSpec> =
  TSpec extends ZodType<infer TPayload> ? TPayload : TSpec extends NoPayloadSignal ? void : never

/** Call arguments for payload-bearing versus no-payload signal sends. */
export type FlowSignalPayloadArgs<TPayload> = [TPayload] extends [void] ? [] : [payload: TPayload]

/** Untyped signal sends stay available for flows without a local signal map. */
export type UntypedSignalPayloadArgs = [payload?: JsonValue]

const NO_PAYLOAD_SIGNAL = Object.freeze({
  _tag: NO_PAYLOAD_SIGNAL_TAG,
}) satisfies NoPayloadSignal

/**
 * Declare that a local flow signal carries no payload.
 *
 * @returns A reusable marker for a signal-map entry.
 *
 * @example
 * ```ts
 * const review = flow(
 *   'review',
 *   { signals: { cancel: noPayload() } },
 *   async (flow) => {
 *     await flow.suspend('cancel')
 *   },
 * )
 *
 * await review.signal(flowId, 'cancel')
 * ```
 */
export function noPayload(): NoPayloadSignal {
  return NO_PAYLOAD_SIGNAL
}

/** Return true when a signal declaration was created by {@link noPayload}. */
export function isNoPayloadSignal(value: unknown): value is NoPayloadSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_tag' in value &&
    (value as { readonly _tag?: unknown })._tag === NO_PAYLOAD_SIGNAL_TAG
  )
}

/** Return the runtime schema for a signal declaration, if it has one. */
export function signalSchemaFor(spec: FlowSignalSpec | undefined): ZodType<unknown> | undefined {
  if (!spec || isNoPayloadSignal(spec)) return undefined
  return spec as ZodType<unknown>
}

/**
 * Error thrown when a delivered signal payload does not match its declaration.
 *
 * Callers can branch on this class when they want to distinguish malformed
 * signal delivery from flow lifecycle control errors.
 */
export class InvalidSignalPayloadError extends Error {
  readonly signalName: string

  constructor(signalName: string, detail: string) {
    super(`Invalid signal payload for "${signalName}": ${detail}`)
    this.name = 'InvalidSignalPayloadError'
    this.signalName = signalName
  }
}

/**
 * Validate a payload against a declared local signal schema.
 *
 * Local signal maps are runtime contracts as well as type contracts. This
 * helper keeps schema parsing near the signal declaration utilities so the
 * flow executor can stay focused on lifecycle control.
 *
 * @param signalName - Local signal name being delivered.
 * @param spec - Signal declaration from the flow's local signal map.
 * @param payload - Payload supplied by a caller or loaded from persistence.
 * @returns The parsed payload when a schema exists, or the original payload.
 */
export function validateSignalPayload(
  signalName: string,
  spec: FlowSignalSpec | undefined,
  payload: unknown,
): unknown {
  if (isNoPayloadSignal(spec)) {
    if (isEmptySignalPayload(payload)) return payload
    throw new InvalidSignalPayloadError(signalName, 'expected no payload')
  }

  const schema = signalSchemaFor(spec)
  if (!schema) return payload

  const result = schema.safeParse(payload)
  if (result.success) return result.data

  throw new InvalidSignalPayloadError(signalName, formatSignalPayloadIssues(result.error))
}

function isEmptySignalPayload(payload: unknown): boolean {
  if (payload === undefined || payload === null) return true
  if (!isPlainRecord(payload)) return false
  return Object.keys(payload).length === 0
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function formatSignalPayloadIssues(error: ZodError<unknown>): string {
  if (error.issues.length === 0) return error.message
  return error.issues.map(formatSignalPayloadIssue).join('; ')
}

function formatSignalPayloadIssue(issue: ZodError<unknown>['issues'][number]): string {
  const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : ''
  return `${issue.message}${path}`
}
