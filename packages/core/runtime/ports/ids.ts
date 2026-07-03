/**
 * Branded runtime identifiers shared by engine ports and adapter contracts.
 *
 * The runtime stores ids as strings on the wire, but distinct brands prevent
 * accidental interchange between work ids, flow ids, task ids, cursors, and
 * lease tokens in adapter implementations.
 *
 * @module
 */

type RuntimeBrand<TName extends string> = string & { readonly __brand: TName }

/** Stable id for a runtime work record. */
export type WorkId = RuntimeBrand<'WorkId'>

/** Stable id for a durable flow instance. */
export type FlowId = RuntimeBrand<'FlowId'>

/** Name-based durable target identity, such as `flow("review")`. */
export type RuntimeTargetId = RuntimeBrand<'RuntimeTargetId'>

/** Durable event cursor returned by an event store. */
export type EventCursor = RuntimeBrand<'EventCursor'>

/** Stable id for queued task or wake delivery records. */
export type TaskId = RuntimeBrand<'TaskId'>

/** Stable id for an armed runtime waiter. */
export type WaiterId = RuntimeBrand<'WaiterId'>

/** Stable id for a durable timer registration. */
export type TimerId = RuntimeBrand<'TimerId'>

/** Opaque token proving ownership of a leased runtime resource. */
export type LeaseToken = RuntimeBrand<'LeaseToken'>
