/** Privacy-safe projections for errors that must still be rethrown unchanged. @module */

const observationMessages = new WeakMap<object, string>()
const primitiveObservationMessages = new Map<unknown, string>()
const MAX_PRIMITIVE_PROJECTIONS = 256
const SATURATED_PRIMITIVE_MESSAGE = 'Operation failed with redacted details.'
let primitiveProjectionSaturated = false

/**
 * Associate an error with the message observability and persisted traces may retain.
 *
 * The association does not mutate or wrap the thrown value, so callers still
 * receive the original provider error. Primitive projections use a bounded
 * registry that permanently fails closed after saturation; same-value
 * collisions therefore only cause conservative over-redaction.
 *
 * @internal
 */
export function markErrorForObservation(error: unknown, message: string): void {
  if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
    observationMessages.set(error, message)
    return
  }
  if (primitiveObservationMessages.has(error)) {
    primitiveObservationMessages.set(error, message)
    return
  }
  if (primitiveProjectionSaturated) return
  if (primitiveObservationMessages.size >= MAX_PRIMITIVE_PROJECTIONS) {
    primitiveProjectionSaturated = true
    return
  }
  primitiveObservationMessages.set(error, message)
}

/** Return an error-shaped safe projection when one has been registered. @internal */
export function projectErrorForObservation(error: unknown): unknown {
  if ((typeof error !== 'object' || error === null) && typeof error !== 'function') {
    const message = primitiveObservationMessages.get(error)
    if (message !== undefined) return new Error(message)
    return primitiveProjectionSaturated ? new Error(SATURATED_PRIMITIVE_MESSAGE) : error
  }
  const message = observationMessages.get(error)
  return message === undefined ? error : new Error(message)
}
