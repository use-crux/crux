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

import type { PromptMiddleware } from "./types";
import type {
  ResolveHook,
  ExecutionHook,
  StreamProgressHook,
  StreamStartHook,
} from "./middleware";
import type {
  CruxAttributes,
  CruxObservabilityTransport,
  ObservabilityDeliveryOptions,
} from "../observability";
import type { CruxObservabilityCapturePolicy } from "../observability/capture-policy";
import type { CapturedObservabilityContext } from "../observability/context";
import type { CruxPropagationCarrier } from "../observability/continuation";
import type { ProjectIndexRuntimeTransport } from "../project-index/runtime";
import type { RecordStore } from "../storage";
import type { RuntimeEngineDefinition } from "./api/runtime-definition";
import type { CruxHostBinding } from "../scope/types";
import { getCruxProcessRegistry } from "./process-registry";

/**
 * Activates the real execution context (e.g. an OTel span) around the actual
 * callback for one observability span or run.
 *
 * Installed by telemetry plugins so `trace.getActiveSpan()` (or an equivalent
 * host API) resolves correctly inside the instrumented work itself, not only
 * inside a graph-record subscriber running downstream of it. `fn` may be sync
 * or return a promise; the hook must return whatever `fn` returns unchanged.
 */
export type SpanActivationHook = <T>(
  context: CapturedObservabilityContext,
  fn: () => T,
) => T;

/** Bounds for {@link TelemetryFlushHook}. */
export interface TelemetryFlushHookOptions {
  /** Milliseconds remaining to flush, combining any explicit timeout with the active host deadline. Omit to wait unbounded. */
  readonly deadlineMs?: number;
}

/** Structured, non-throwing outcome of a telemetry manager's bounded flush. */
export interface TelemetryFlushHookResult {
  /** `false` when the flush could not complete (e.g. timed out) — never a thrown error. */
  readonly ok: boolean;
  readonly timedOut?: boolean;
}

/**
 * Bounded, provider-neutral hook that flushes an installed telemetry
 * manager's own exporter/processor work.
 *
 * `observe.flush()`/`observe.shutdown()` invoke this alongside the delivery
 * engine's own drain, so real per-boundary flush points (host wrappers,
 * Convex actions, explicit `observe.flush()` calls) also wait for standard
 * and lightweight OTel exporter work, not only plugin teardown. Must never
 * throw — failures are reported via `{ ok: false }`.
 */
export type TelemetryFlushHook = (
  options: TelemetryFlushHookOptions,
) => Promise<TelemetryFlushHookResult>;

/**
 * Derives extra attributes to attach to a resumed run/segment from its
 * propagation carrier (e.g. allowlisted W3C baggage members).
 *
 * Installed by telemetry plugins and invoked by `observe.resumeRun()` — the
 * one first-party choke point every Flow and Convex resume boundary already
 * funnels through — so baggage that crossed a suspend/resume boundary can be
 * projected onto the resumed segment's root span. Returns `undefined` when
 * there is nothing to add. Must never throw.
 */
export type TelemetryResumeAttributesHook = (
  carrier: CruxPropagationCarrier,
) => CruxAttributes | undefined;

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
  middleware?: PromptMiddleware;
  /** Fires when a prompt is resolved via the agent adapter. */
  resolveHook?: ResolveHook;
  /** Fires after each model call from the agent adapter. */
  executionHook?: ExecutionHook;
  /** Creates a progress reporter for live streaming metrics. */
  streamProgressHook?: StreamProgressHook;
  /** Fires immediately when a stream begins, before any chunks arrive. */
  streamStartHook?: StreamStartHook;
  /** Canonical observability graph transport and delivery bounds. */
  observabilityTransport?: CruxObservabilityTransport;
  /** Best-effort owner-scoped Project Index runtime-update delivery. */
  projectIndexRuntimeTransport?: ProjectIndexRuntimeTransport;
  observabilityDelivery?: ObservabilityDeliveryOptions;
  /** Central policy for whether canonical observability artifacts include payload previews. */
  observabilityCapture?: CruxObservabilityCapturePolicy;
  /** Activates the real execution context (e.g. an OTel span) around observed span/run work. */
  spanActivationHook?: SpanActivationHook;
  /** Bounded flush of an installed telemetry manager's own exporter/processor work. */
  telemetryFlushHook?: TelemetryFlushHook;
  /** Derives extra attributes for a resumed run/segment from its propagation carrier. */
  telemetryResumeAttributesHook?: TelemetryResumeAttributesHook;
  /** Global record store for flow state persistence (suspend/resume). */
  records?: RecordStore;
  /** Durable Runtime Engine composer configured for runtime-bound APIs. */
  runtimeEngine?: RuntimeEngineDefinition;
  /** Explicit host binding configured for invocation retention. */
  hostBinding?: CruxHostBinding;
  /** Global constraints registered via createConstraintPlugin(). */
  globalConstraints?: import("../safety/constraint/types").Constraint[];
  /** Global guardrails registered via createGuardrailPlugin(). */
  globalGuardrails?: import("../safety/guardrail/types").Guardrail[];
  /** True when createSemanticCache() is installed. Used for dev warnings on inert prompt hints. */
  semanticCacheInstalled?: boolean;
}

const hooksLayerBrand = Symbol("CruxHooksLayerToken");

/**
 * Opaque handle returned by {@link pushHooksLayer}.
 *
 * Pass this token to {@link restoreHooksLayer} to restore exactly the hook
 * keys touched by that layer. Tokens are intentionally not constructible by
 * callers; keep the value returned from `pushHooksLayer()`.
 */
export interface HooksLayerToken {
  readonly [hooksLayerBrand]: true;
  readonly id: number;
}

const runtimeRegistry = getCruxProcessRegistry().runtime;

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
  return Object.freeze({ ...runtimeRegistry.currentHooks });
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
  runtimeRegistry.currentHooks = { ...hooks };
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
  runtimeRegistry.currentHooks = { ...runtimeRegistry.currentHooks, ...patch };
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
  const id = runtimeRegistry.nextHooksLayerId++;
  const keys = Object.keys(patch) as (keyof CruxHooks)[];
  runtimeRegistry.hooksLayers.set(id, {
    keys,
    previousHooks: { ...runtimeRegistry.currentHooks },
  });
  runtimeRegistry.currentHooks = { ...runtimeRegistry.currentHooks, ...patch };
  return { id, [hooksLayerBrand]: true };
}

/**
 * Restore the hook keys captured by a previous hook layer.
 *
 * Restores are idempotent: calling this with an already-restored token is a
 * no-op. Out-of-order restores are allowed; the restore writes the captured
 * previous value for each key and leaves all other keys untouched.
 */
export function restoreHooksLayer(token: HooksLayerToken): void {
  const layer = runtimeRegistry.hooksLayers.get(token.id);
  if (!layer) return;

  runtimeRegistry.hooksLayers.delete(token.id);
  const nextHooks: CruxHooks = { ...runtimeRegistry.currentHooks };
  for (const key of layer.keys) {
    if (Object.prototype.hasOwnProperty.call(layer.previousHooks, key)) {
      copyHookField(nextHooks, layer.previousHooks, key);
    } else {
      delete nextHooks[key];
    }
  }
  runtimeRegistry.currentHooks = nextHooks;
}

/**
 * Clear all hook state.
 *
 * Equivalent to `setHooks({})`. Used in test cleanup and
 * when tearing down devtools.
 */
export function resetHooks(): void {
  runtimeRegistry.currentHooks = {};
  runtimeRegistry.hooksLayers.clear();
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
  const records = runtimeRegistry.currentHooks.records;
  if (!records) {
    throw new Error(
      "No RecordStore configured. Call config({ persistence: { records } }) before using plans, tasks, or flows.",
    );
  }
  return records;
}

function copyHookField<K extends keyof CruxHooks>(
  target: CruxHooks,
  source: Readonly<CruxHooks>,
  key: K,
): void {
  target[key] = source[key];
}
