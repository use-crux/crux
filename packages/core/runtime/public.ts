/**
 * `@use-crux/core/runtime` — Runtime Engine contracts and pure helpers.
 *
 * This subpath exposes the provider-agnostic Runtime Engine surface for adapter
 * authors, conformance tests, generated wake handlers, and advanced users who
 * need to reason about durable work directly.
 *
 * @module
 */

export {
  CruxRuntimeError,
  RUNTIME_ERROR_CODES,
  createRuntimeError,
  runtimeErrorDocsUrl,
} from './engine/errors'
export type { CruxRuntimeErrorCode, RuntimeErrorInput } from './engine/errors'

export {
  MAX_WAKE_ENVELOPE_BYTES,
  decodeWakeEnvelope,
  encodeWakeEnvelope,
} from './engine/envelope'
export type { WakeEnvelope } from './engine/envelope'

export { classifyRuntimeFailure, retryDelayMs } from './engine/retry'
export type {
  RetryDelayOptions,
  RuntimeFailureClassification,
  RuntimeFailureClassificationOptions,
} from './engine/retry'

export { transition } from './engine/work'
export type {
  WorkItem,
  WorkItemError,
  WorkStatus,
  WorkTransition,
} from './engine/work'

export type * from './ports'
export type * from './store'

export { inMemoryRuntimeStore } from './adapters/memory'
export type {
  InMemoryRuntimeStore,
  InMemoryRuntimeStoreTesting,
} from './adapters/memory'
