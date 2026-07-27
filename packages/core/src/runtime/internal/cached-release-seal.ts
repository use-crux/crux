/**
 * Private evidence that a cached stream candidate passed its release gate.
 *
 * The seal lets stream bookkeeping consume an already accepted canonical
 * payload without re-running output guardrails, authored schema parsing, or
 * constraints. It is intentionally descriptor-only evidence: non-enumerable,
 * non-serializable, and never exported from a package entry point.
 *
 * @internal
 * @module
 */

/** Accepted payload used to construct and complete one cached replay. */
export interface CachedReleaseSeal {
  /** Whether the accepted candidate publishes text only or structured output. */
  readonly resultKind: "text" | "object";
  /** Accepted text bytes used to construct the replay. */
  readonly text: string;
  /** Current authored-schema `z.output`, for a structured candidate. */
  readonly object?: unknown;
}

const cachedReleaseSeal: unique symbol = Symbol(
  "@use-crux/core/runtime/cachedReleaseSeal",
);

type CachedReleaseSealCarrier = {
  readonly [cachedReleaseSeal]?: CachedReleaseSeal;
};

/**
 * Attach accepted cached-stream evidence without exposing public metadata.
 *
 * @param target - Internal replay handle that will carry the seal.
 * @param seal - Canonical accepted payload used by downstream bookkeeping.
 * @returns The same target with a private release-seal capability.
 */
export function attachCachedReleaseSeal<TTarget extends object>(
  target: TTarget,
  seal: CachedReleaseSeal,
): TTarget & CachedReleaseSealCarrier {
  Object.defineProperty(target, cachedReleaseSeal, {
    value: Object.freeze({ ...seal }),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return target;
}

/**
 * Read accepted cached-stream evidence from an internal replay handle.
 *
 * @param carrier - Potential internal seal carrier.
 * @returns The accepted payload, or `undefined` for a live stream.
 */
export function readCachedReleaseSeal(
  carrier: object,
): CachedReleaseSeal | undefined {
  return (carrier as CachedReleaseSealCarrier)[cachedReleaseSeal];
}
