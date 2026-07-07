/**
 * Centralized hook state for process-wide Crux instrumentation.
 *
 * Replaces the scattered setter/getter pairs that were spread across
 * `middleware.ts`, `testing.ts`, and `flow/scope.ts`.
 * All hook state lives in a single `CruxHooks` object. Config, plugins, and
 * devtools can install or restore related fields atomically without sharing
 * mutable module-level setters for each hook family.
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
 * Devtools and config install fields atomically through layer tokens.
 * Primitives read individual fields via `getHooks()`.
 *
 * @example
 * ```ts
 * import { setHooks, resetHooks } from '@use-crux/core'
 *
 * // Install all hooks at once
 * setHooks({
 *   middleware: myMiddleware,
 * })
 *
 * // Tear down cleanly
 * resetHooks()
 * ```
 */
export interface CruxHooks {
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

const hooksLayerBrand = Symbol('CruxHooksLayerToken')

/**
 * Opaque handle returned by {@link pushHooksLayer}.
 *
 * Pass this token to {@link restoreHooksLayer} to restore exactly the hook
 * keys touched by that layer. Tokens are intentionally not constructible by
 * callers; keep the value returned from `pushHooksLayer()`.
 */
export interface HooksLayerToken {
  readonly [hooksLayerBrand]: true
  readonly id: number
}

interface HooksLayer {
  readonly keys: readonly (keyof CruxHooks)[]
  readonly previousHooks: Readonly<CruxHooks>
}

let currentHooks: CruxHooks = {}
let nextHooksLayerId = 1
const hooksLayers = new Map<number, HooksLayer>()

/**
 * Get the current hook state.
 *
 * Returns a frozen shallow copy — safe to destructure, cannot be mutated.
 *
 * @example
 * ```ts
 * const { middleware, observabilityTransport } = getHooks()
 * ```
 */
export function getHooks(): Readonly<CruxHooks> {
  return Object.freeze({ ...currentHooks })
}

/**
 * Replace the entire hook store atomically.
 *
 * Used by plugin install to set all hooks in a single call,
 * and by plugin dispose to restore the previous state.
 *
 * @param hooks - The new hook state. A defensive copy is made.
 *
 * @example
 * ```ts
 * const previous = getHooks()
 * setHooks({ middleware, resolveHook, executionHook })
 * // later: restore
 * setHooks(previous)
 * ```
 */
export function setHooks(hooks: CruxHooks): void {
  currentHooks = { ...hooks }
}

/**
 * Merge partial fields into the current hook store.
 *
 * Unmentioned fields are preserved. Explicitly passing `undefined`
 * clears that field.
 *
 * @param patch - Fields to merge into the current hook store.
 *
 * @example
 * ```ts
 * updateHooks({ middleware: myMiddleware })
 * updateHooks({ middleware: undefined }) // clear middleware only
 * ```
 */
export function updateHooks(patch: Partial<CruxHooks>): void {
  currentHooks = { ...currentHooks, ...patch }
}

/**
 * Install a partial hook layer and return a token that can restore it.
 *
 * Only keys present in `patch` are captured and restored. Other layers that
 * write different keys remain intact, so config teardown can coexist with
 * devtools or test-installed hooks.
 *
 * @param patch - Hook fields installed by this layer.
 * @returns An opaque restore token for this layer.
 *
 * @example
 * ```ts
 * const token = pushHooksLayer({ middleware })
 * // later
 * restoreHooksLayer(token)
 * ```
 */
export function pushHooksLayer(patch: Partial<CruxHooks>): HooksLayerToken {
  const id = nextHooksLayerId++
  const keys = Object.keys(patch) as (keyof CruxHooks)[]
  hooksLayers.set(id, {
    keys,
    previousHooks: { ...currentHooks },
  })
  currentHooks = { ...currentHooks, ...patch }
  return { id, [hooksLayerBrand]: true }
}

/**
 * Restore the hook keys captured by a previous hook layer.
 *
 * Restores are idempotent: calling this with an already-restored token is a
 * no-op. Out-of-order restores are allowed; the restore writes the captured
 * previous value for each key and leaves all other keys untouched.
 */
export function restoreHooksLayer(token: HooksLayerToken): void {
  const layer = hooksLayers.get(token.id)
  if (!layer) return

  hooksLayers.delete(token.id)
  const nextHooks: CruxHooks = { ...currentHooks }
  for (const key of layer.keys) {
    if (Object.prototype.hasOwnProperty.call(layer.previousHooks, key)) {
      copyHookField(nextHooks, layer.previousHooks, key)
    } else {
      delete nextHooks[key]
    }
  }
  currentHooks = nextHooks
}

/**
 * Clear all hook state.
 *
 * Equivalent to `setHooks({})`. Used in test cleanup and
 * when tearing down devtools.
 */
export function resetHooks(): void {
  currentHooks = {}
  hooksLayers.clear()
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
  const records = currentHooks.records
  if (!records) {
    throw new Error(
      'No RecordStore configured. Call config({ persistence: { records } }) before using plans, tasks, or flows.',
    )
  }
  return records
}

function copyHookField<K extends keyof CruxHooks>(
  target: CruxHooks,
  source: Readonly<CruxHooks>,
  key: K,
): void {
  target[key] = source[key]
}
