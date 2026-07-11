/**
 * W3C propagation for the Crux continuation carrier.
 *
 * `@use-crux/core`'s `injectPropagationCarrier`/`extractPropagationCarrier`
 * are the always-available, dependency-free correctness path (format/length
 * bounds, `crux` field validation). This module additionally routes through
 * the configured OTel propagator when `@opentelemetry/api` is loadable and a
 * real propagator is registered, so `traceparent`/`tracestate`/`baggage`
 * interoperate with other OTel-instrumented services in the same trace and
 * with any additional fields the app's propagator adds.
 *
 * Baggage is untrusted input: only allowlisted keys are ever copied into Crux
 * attributes, values are length-capped, and extraction failures degrade to
 * "no baggage attributes" instead of throwing.
 *
 * @module
 */

import type {
  CruxPropagationCarrier,
  CruxPropagationHeaderCarrier,
} from '@use-crux/core/observability'
import { extractPropagationCarrier, injectPropagationCarrier } from '@use-crux/core/observability'

const MAX_BAGGAGE_ATTRIBUTE_VALUE_LENGTH = 200
const MAX_BAGGAGE_ATTRIBUTES = 32

interface OtelBaggageEntry {
  readonly value: string
}

interface OtelBaggageLike {
  getAllEntries(): Array<[string, OtelBaggageEntry]>
}

interface OtelPropagationApiLike {
  context: { active(): unknown }
  trace: {
    setSpanContext(context: unknown, spanContext: { traceId: string; spanId: string; traceFlags: number; isRemote: boolean }): unknown
  }
  propagation: {
    inject(context: unknown, carrier: unknown, setter: { set(carrier: unknown, key: string, value: string): void }): void
    extract(context: unknown, carrier: unknown, getter: { get(carrier: unknown, key: string): string | undefined; keys(carrier: unknown): string[] }): unknown
    getBaggage(context: unknown): OtelBaggageLike | undefined
    createBaggage(entries: Record<string, OtelBaggageEntry>): OtelBaggageLike
    setBaggage(context: unknown, baggage: OtelBaggageLike): unknown
  }
}

/**
 * Inject a validated carrier into a header-like transport boundary.
 *
 * Always writes the Crux `traceparent`/`tracestate`/`baggage`/`crux` fields
 * through {@link injectPropagationCarrier}. When a real OTel propagator is
 * registered, also routes through `propagation.inject()` so any additional
 * fields the app's propagator contributes (beyond the W3C trace context and
 * baggage headers Crux already writes) are set too.
 */
export function injectCruxPropagationCarrier(
  carrier: CruxPropagationCarrier,
  target: CruxPropagationHeaderCarrier,
): void {
  injectPropagationCarrier(carrier, target)

  const api = loadOtelPropagationApi()
  if (!api) return
  try {
    const context = contextFromCarrier(api, carrier)
    api.propagation.inject(context, target, {
      set: (headerCarrier, key, value) => (headerCarrier as CruxPropagationHeaderCarrier).set(key, value),
    })
  } catch {
    // OTel propagation is additive; a failure here never blocks the Crux carrier already written above.
  }
}

export interface ExtractCruxPropagationCarrierOptions {
  /**
   * Baggage member keys allowed to become `crux.baggage.<key>` span
   * attributes. Baggage is untrusted input — nothing is copied by default.
   */
  readonly baggageAttributeAllowlist?: readonly string[]
}

export interface ExtractedCruxPropagationCarrier {
  /** `undefined` when the source carries no usable, valid continuation. */
  readonly carrier: CruxPropagationCarrier | undefined
  /** Allowlisted baggage members projected to bounded, sanitized attribute values. */
  readonly baggageAttributes: Readonly<Record<string, string>>
}

/**
 * Extract a validated carrier plus allowlisted baggage attributes from a
 * header-like transport boundary.
 *
 * Never throws: an invalid or missing carrier resolves to
 * `{ carrier: undefined, baggageAttributes: {} }` so callers can start a
 * fresh trace/run instead of crashing user code.
 */
export function extractCruxPropagationCarrier(
  source: Pick<CruxPropagationHeaderCarrier, 'get'>,
  options: ExtractCruxPropagationCarrierOptions = {},
): ExtractedCruxPropagationCarrier {
  let carrier: CruxPropagationCarrier | undefined
  try {
    carrier = extractPropagationCarrier(source)
  } catch {
    carrier = undefined
  }

  const allowlist = options.baggageAttributeAllowlist
  if (!carrier || !allowlist || allowlist.length === 0) {
    return { carrier, baggageAttributes: {} }
  }

  return { carrier, baggageAttributes: baggageAttributesFromCarrier(carrier, allowlist) }
}

/**
 * Project allowlisted baggage members from an already-parsed carrier (e.g.
 * one that crossed a first-party Flow/Convex resume boundary as a JSON
 * continuation rather than real wire headers) into bounded, sanitized
 * `crux.baggage.<key>` attribute values.
 *
 * Nothing is copied by default — baggage is untrusted input, so a caller must
 * pass an explicit allowlist. Never throws.
 */
export function baggageAttributesFromCarrier(
  carrier: CruxPropagationCarrier,
  allowlist: readonly string[],
): Readonly<Record<string, string>> {
  if (!carrier.baggage || allowlist.length === 0) return {}
  try {
    return baggageAttributesFor(carrier.baggage, allowlist)
  } catch {
    return {}
  }
}

function baggageAttributesFor(baggageHeader: string, allowlist: readonly string[]): Record<string, string> {
  const allowed = new Set(allowlist)
  const attributes: Record<string, string> = {}
  const api = loadOtelPropagationApi()
  const members = api ? membersFromOtelPropagator(api, baggageHeader) : membersFromRawHeader(baggageHeader)

  for (const [key, value] of members) {
    if (!allowed.has(key)) continue
    if (Object.keys(attributes).length >= MAX_BAGGAGE_ATTRIBUTES) break
    attributes[`crux.baggage.${key}`] = boundedSafeValue(value)
  }
  return attributes
}

/** Prefer the registered W3C baggage propagator's parsing/validation when available. */
function membersFromOtelPropagator(api: OtelPropagationApiLike, baggageHeader: string): Array<[string, string]> {
  try {
    const context = api.propagation.extract(api.context.active(), { baggage: baggageHeader }, {
      get: (carrier, key) => (carrier as Record<string, string>)[key],
      keys: (carrier) => Object.keys(carrier as Record<string, string>),
    })
    const baggage = api.propagation.getBaggage(context)
    if (!baggage) return membersFromRawHeader(baggageHeader)
    return baggage.getAllEntries().map(([key, entry]) => [key, entry.value])
  } catch {
    return membersFromRawHeader(baggageHeader)
  }
}

/** Minimal standards-compliant fallback: core has already bounded overall length/member count. */
function membersFromRawHeader(baggageHeader: string): Array<[string, string]> {
  const members: Array<[string, string]> = []
  for (const rawMember of baggageHeader.split(',')) {
    const [rawKey, ...rest] = rawMember.split(';')[0]?.split('=') ?? []
    if (!rawKey || rest.length === 0) continue
    const key = decodeBaggageComponent(rawKey.trim())
    const value = decodeBaggageComponent(rest.join('=').trim())
    if (!key || value === undefined) continue
    members.push([key, value])
  }
  return members
}

function decodeBaggageComponent(component: string): string | undefined {
  if (!component) return undefined
  try {
    return decodeURIComponent(component)
  } catch {
    return undefined
  }
}

const CONTROL_CHAR_PATTERN = new RegExp('[\\u0000-\\u001f\\u007f]', 'gu')

function boundedSafeValue(value: string): string {
  const sanitized = value.replace(CONTROL_CHAR_PATTERN, '')
  return sanitized.length > MAX_BAGGAGE_ATTRIBUTE_VALUE_LENGTH
    ? `${sanitized.slice(0, MAX_BAGGAGE_ATTRIBUTE_VALUE_LENGTH)}…`
    : sanitized
}

function contextFromCarrier(api: OtelPropagationApiLike, carrier: CruxPropagationCarrier): unknown {
  let context = api.context.active()
  const match = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u.exec(carrier.traceparent ?? '')
  if (match) {
    context = api.trace.setSpanContext(context, {
      traceId: match[2]!,
      spanId: match[3]!,
      traceFlags: Number.parseInt(match[4]!, 16),
      isRemote: true,
    })
  }
  if (carrier.baggage) {
    const entries: Record<string, OtelBaggageEntry> = {}
    for (const [key, value] of membersFromRawHeader(carrier.baggage)) entries[key] = { value }
    if (Object.keys(entries).length > 0) {
      context = api.propagation.setBaggage(context, api.propagation.createBaggage(entries))
    }
  }
  return context
}

function loadOtelPropagationApi(): OtelPropagationApiLike | undefined {
  const requireModule = getRequire()
  if (!requireModule) return undefined
  try {
    return requireModule('@opentelemetry/api') as OtelPropagationApiLike
  } catch {
    return undefined
  }
}

function getRequire(): ((id: string) => unknown) | undefined {
  const runtime = globalThis as typeof globalThis & {
    require?: (id: string) => unknown
    process?: { getBuiltinModule?: (id: string) => unknown }
  }
  if (runtime.require) return runtime.require

  try {
    const nodeModule = runtime.process?.getBuiltinModule?.('node:module') as
      | { createRequire?: (url: string) => (id: string) => unknown }
      | undefined
    return nodeModule?.createRequire?.(import.meta.url)
  } catch {
    return undefined
  }
}
