/**
 * Private structured-candidate cache representation.
 *
 * A public generated `result.object` is authored-schema `z.output`. Releasing a
 * cache hit must instead re-evaluate the accepted post-guard `z.input`, because
 * transforms and coercions are not necessarily idempotent.
 *
 * @internal
 * @module
 */

/**
 * Versioned persisted evidence for one accepted structured candidate.
 *
 * `canonicalInput` is the value after terminal output guardrails and before the
 * authored schema. It is deliberately separate from the cached public object.
 */
export interface SerializedStructuredCandidateV1 {
  /** Identifies the private serialized structured-candidate contract. */
  readonly version: 1;
  /** Accepted canonical schema input after terminal output guardrails. */
  readonly canonicalInput: unknown;
}

const structuredCandidate: unique symbol = Symbol(
  "@use-crux/core/runtime/cachedStructuredCandidate",
);

type StructuredCandidateCarrier = {
  readonly [structuredCandidate]?: SerializedStructuredCandidateV1;
};

/** Attach accepted canonical input without exposing it to public enumeration. */
export function attachCachedStructuredCandidate<TTarget extends object>(
  target: TTarget,
  canonicalInput: unknown,
): TTarget & StructuredCandidateCarrier {
  Object.defineProperty(target, structuredCandidate, {
    value: { version: 1, canonicalInput },
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return target;
}

/** Read the supported private payload from a live or hydrated result. */
export function readCachedStructuredCandidate(
  carrier: object,
): SerializedStructuredCandidateV1 | undefined {
  const value = (carrier as StructuredCandidateCarrier)[structuredCandidate];
  return isSerializedStructuredCandidate(value) ? value : undefined;
}

/**
 * Restore a supported serialized payload onto a hydrated middleware result.
 *
 * Missing, malformed, and future-version payloads intentionally remain absent;
 * the adapter finalizer classifies that absence as a schema rejection.
 */
export function hydrateCachedStructuredCandidate<TTarget extends object>(
  target: TTarget,
  value: unknown,
): TTarget {
  return isSerializedStructuredCandidate(value)
    ? attachCachedStructuredCandidate(target, value.canonicalInput)
    : target;
}

/** Validate the private persisted representation without inspecting its value. */
function isSerializedStructuredCandidate(
  value: unknown,
): value is SerializedStructuredCandidateV1 {
  return Boolean(
    value !== null &&
    typeof value === "object" &&
    (value as { readonly version?: unknown }).version === 1 &&
    Object.prototype.hasOwnProperty.call(value, "canonicalInput"),
  );
}
