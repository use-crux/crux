/**
 * Canonical routing receipt types and helpers.
 *
 * A receipt is the caller-visible trace of wrapper decisions for one routed
 * model resolution. It is append-only through recursion: outer decisions appear
 * before the nested decisions they selected.
 *
 * @module
 */

/** One routed call receipt exposed on results, stream completions, and errors. */
export interface RoutingReceipt {
  /** Final concrete provider model id. Never a routing wrapper label. */
  readonly model: string
  /** Total routed-call cost when all relevant participants reported cost. */
  readonly cost: number | undefined
  /** Milliseconds from routed stream hand-off to the first emitted token. */
  readonly firstTokenAt?: number
  /** Ordered routing decisions, outermost first. */
  readonly trace: readonly RoutingStep[]
}

/** One decision step inside a {@link RoutingReceipt}. */
export type RoutingStep =
  | RouterRoutingStep
  | SplitRoutingStep
  | RetryRoutingStep
  | FallbackRoutingStep
  | CascadeRoutingStep

/** Router classification and selected route. */
export interface RouterRoutingStep {
  readonly kind: 'router'
  readonly id?: string
  readonly classifiedAs: string
  readonly route: string
  readonly usedDefaultRoute: boolean
  readonly forced: boolean
}

/** Split bucket selection. Added by Phase 6. */
export interface SplitRoutingStep {
  readonly kind: 'split'
  readonly id?: string
  readonly route: string
  readonly seed: string
}

/** Retry attempts. Added by Phase 6. */
export interface RetryRoutingStep {
  readonly kind: 'retry'
  readonly id?: string
  readonly model: string
  readonly attempts: readonly AttemptDetail[]
}

/** Ordered fallback attempts. */
export interface FallbackRoutingStep {
  readonly kind: 'fallback'
  readonly id?: string
  readonly attempts: readonly AttemptDetail[]
  readonly firstTokenAt?: number
  readonly midStreamFailure?: boolean
}

/** Ordered cascade tier evaluations. */
export interface CascadeRoutingStep {
  readonly kind: 'cascade'
  readonly id?: string
  readonly tiers: readonly TierDetail[]
  readonly acceptedAtTier: number
  readonly budgetExceeded: boolean
}

/** Provider attempt detail used by fallback and retry steps. */
export interface AttemptDetail {
  readonly model: string
  readonly status: 'ok' | 'error'
  readonly durationMs: number
  readonly cost?: number
  readonly errorCategory?: string
  readonly error?: string
  readonly delayMs?: number
}

/** Cascade tier detail included in routing receipts. */
export interface TierDetail {
  readonly model: string
  readonly status: 'accepted' | 'rejected' | 'skipped'
  readonly durationMs: number
  readonly cost?: number
  readonly judgeCost?: number
  readonly confidence?: number
  readonly budget?: number
  readonly note?: string
}

/** Result shape after routing has normalized metadata and optional receipt. */
export type RoutableResult<R> = R & {
  readonly _meta: Record<string, unknown>
  readonly routing?: RoutingReceipt
}

/** Return true for object-like records that can carry result fields. */
export function isRoutingRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Clone a provider result and ensure it has a metadata object. */
export function ensureRoutingResult<R>(result: R): RoutableResult<R> {
  if (isRoutingRecord(result)) {
    const meta = isStringRecord(result._meta) ? result._meta : {}
    const clone = Object.assign(Object.create(Object.getPrototypeOf(result)), result) as R & {
      _meta: Record<string, unknown>
    }
    clone._meta = { ...meta }
    return clone as RoutableResult<R>
  }

  return { value: result, _meta: {} } as unknown as RoutableResult<R>
}

/** Return a finite numeric cost from normalized metadata. */
export function routingCostFromMeta(
  meta: Record<string, unknown> | undefined,
): number | undefined {
  const cost = meta?.cost
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : undefined
}

/** Attach a receipt by cloning the result instead of mutating provider output. */
export function withRoutingReceipt<R>(
  result: R,
  receipt: RoutingReceipt,
): RoutableResult<R> {
  const normalized = ensureRoutingResult(result)
  const clone = Object.assign(
    Object.create(Object.getPrototypeOf(normalized)),
    normalized,
  ) as R & { _meta: Record<string, unknown>; routing?: RoutingReceipt }
  clone._meta = { ...normalized._meta }
  clone.routing = receipt
  return clone as RoutableResult<R>
}

/** Create a receipt for a wrapper whose child resolved to a raw model result. */
export function createRoutingReceipt(
  model: string,
  cost: number | undefined,
  trace: readonly RoutingStep[],
  options: { readonly firstTokenAt?: number } = {},
): RoutingReceipt {
  return {
    model,
    cost,
    ...(options.firstTokenAt !== undefined
      ? { firstTokenAt: options.firstTokenAt }
      : {}),
    trace: [...trace],
  }
}

/** Prepend an outer wrapper step to a nested receipt. */
export function prependRoutingStep(
  step: RoutingStep,
  nested: RoutingReceipt,
): RoutingReceipt {
  return {
    model: nested.model,
    cost: nested.cost,
    ...(nested.firstTokenAt !== undefined
      ? { firstTokenAt: nested.firstTokenAt }
      : {}),
    trace: [step, ...nested.trace],
  }
}

/** Attach a routing receipt to an Error-like object. */
export function attachRoutingToError<T extends Error>(
  error: T,
  routing: RoutingReceipt,
): T & { readonly routing: RoutingReceipt } {
  Object.defineProperty(error, 'routing', {
    value: routing,
    enumerable: true,
    configurable: true,
  })
  return error as T & { readonly routing: RoutingReceipt }
}

/** Mark fallback steps in a receipt as mid-stream failures. */
export function markRoutingMidStreamFailure(
  routing: RoutingReceipt,
): RoutingReceipt {
  return {
    ...routing,
    trace: routing.trace.map((step) =>
      step.kind === "fallback"
        ? {
            ...step,
            ...(routing.firstTokenAt !== undefined
              ? { firstTokenAt: routing.firstTokenAt }
              : {}),
            midStreamFailure: true,
          }
        : step,
    ),
  };
}

/** Add first-token timing to a receipt without mutating the original. */
export function withRoutingFirstTokenAt(
  routing: RoutingReceipt,
  firstTokenAt: number | undefined,
): RoutingReceipt {
  if (firstTokenAt === undefined) return routing
  return {
    ...routing,
    firstTokenAt,
    trace: routing.trace.map((step) =>
      step.kind === "fallback" ? { ...step, firstTokenAt } : step,
    ),
  }
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
