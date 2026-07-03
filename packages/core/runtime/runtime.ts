/**
 * Centralized runtime state for all global hooks and reporters.
 *
 * Replaces the scattered setter/getter pairs that were spread across
 * `middleware.ts`, `testing.ts`, and `flow/scope.ts`.
 * All hook state lives in a single `CruxRuntime` object, enabling
 * atomic install/uninstall (e.g. plugin install sets everything
 * in one call, plugin dispose restores the previous state).
 *
 * @module
 */

import type { PromptMiddleware } from './types'
import type {
  ResolveHook,
  ExecutionHook,
  StreamProgressHook,
  StreamStartHook,
} from './middleware'
import type { CruxObservabilityTransport, ObservabilityDeliveryOptions } from '../observability'
import type { CruxObservabilityCapturePolicy } from '../observability/capture-policy'
import type { RecordStore } from '../storage'
import type { RuntimeEngineDefinition } from './api/runtime-definition'

/**
 * The set of global hooks and reporters that instrument Crux primitives.
 *
 * Devtools installs all fields atomically via `setRuntime()`.
 * Primitives read individual fields via `getRuntime()`.
 *
 * @example
 * ```ts
 * import { setRuntime, resetRuntime } from '@use-crux/core'
 *
 * // Install all hooks at once
 * setRuntime({
 *   middleware: myMiddleware,
 * })
 *
 * // Tear down cleanly
 * resetRuntime()
 * ```
 */
export interface CruxRuntime {
  /** Wraps every adapter `generate()` call for logging, cost tracking, observability. */
  middleware?: PromptMiddleware
  /** Fires when a prompt is resolved via the agent adapter. */
  resolveHook?: ResolveHook
  /** Fires after each model call from the agent adapter. */
  executionHook?: ExecutionHook
  /** Creates a progress reporter for live streaming metrics. */
  streamProgressHook?: StreamProgressHook
  /** Fires immediately when a stream begins, before any chunks arrive. */
  streamStartHook?: StreamStartHook
  /** Canonical observability graph transport and delivery bounds. */
  observabilityTransport?: CruxObservabilityTransport
  observabilityDelivery?: ObservabilityDeliveryOptions
  /** Central policy for whether canonical observability artifacts include payload previews. */
  observabilityCapture?: CruxObservabilityCapturePolicy
  /** Global record store for flow state persistence (suspend/resume). */
  records?: RecordStore
  /** Durable Runtime Engine composer configured for runtime-bound APIs. */
  runtimeEngine?: RuntimeEngineDefinition
  /** Global constraints registered via createConstraintPlugin(). */
  globalConstraints?: import('../safety/constraint/types').Constraint[]
  /** Global guardrails registered via createGuardrailPlugin(). */
  globalGuardrails?: import('../safety/guardrail/types').Guardrail[]
  /** True when createSemanticCache() is installed. Used for dev warnings on inert prompt hints. */
  semanticCacheInstalled?: boolean
}

let _runtime: CruxRuntime = {}

/**
 * Get the current runtime state.
 *
 * Returns a frozen shallow copy — safe to destructure, cannot be mutated.
 *
 * @example
 * ```ts
 * const { middleware, observabilityTransport } = getRuntime()
 * ```
 */
export function getRuntime(): Readonly<CruxRuntime> {
  return Object.freeze({ ..._runtime })
}

/**
 * Replace the entire runtime atomically.
 *
 * Used by plugin install to set all hooks in a single call,
 * and by plugin dispose to restore the previous state.
 *
 * @param runtime - The new runtime state. A defensive copy is made.
 *
 * @example
 * ```ts
 * const previous = getRuntime()
 * setRuntime({ middleware, resolveHook, executionHook })
 * // later: restore
 * setRuntime(previous)
 * ```
 */
export function setRuntime(runtime: CruxRuntime): void {
  _runtime = { ...runtime }
}

/**
 * Merge partial fields into the current runtime.
 *
 * Unmentioned fields are preserved. Explicitly passing `undefined`
 * clears that field.
 *
 * @param patch - Fields to merge into the current runtime.
 *
 * @example
 * ```ts
 * updateRuntime({ middleware: myMiddleware })
 * updateRuntime({ middleware: undefined }) // clear middleware only
 * ```
 */
export function updateRuntime(patch: Partial<CruxRuntime>): void {
  _runtime = { ..._runtime, ...patch }
}

/**
 * Clear all runtime state.
 *
 * Equivalent to `setRuntime({})`. Used in test cleanup and
 * when tearing down devtools.
 */
export function resetRuntime(): void {
  _runtime = {}
}

/**
 * Resolve the global record store from the runtime, or throw if none is configured.
 *
 * Used internally by plans, tasks, flows, and other primitives that need
 * record persistence. Configure it with `config({ persistence: { records } })`.
 *
 * @throws {Error} If no store has been configured.
 *
 * @example
 * ```ts
 * const records = resolveRecords()
 * await records.put('key', value)
 * ```
 */
export function resolveRecords(): RecordStore {
  const records = _runtime.records
  if (!records) {
    throw new Error(
      'No RecordStore configured. Call config({ persistence: { records } }) before using plans, tasks, or flows.',
    )
  }
  return records
}
