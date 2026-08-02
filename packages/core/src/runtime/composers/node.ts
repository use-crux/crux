/**
 * In-process Node Runtime Engine composer.
 *
 * `node()` is the zero-dependency local and test runtime. It uses the
 * in-memory reference store by default, delivers wake envelopes through a
 * microtask, and can run the kernel maintenance tick on an interval.
 *
 * @module
 */

import type { CruxEngineCapabilities } from "../ports";
import type { RuntimeStoreAdapter } from "../store";
import { MAX_WAKE_ENVELOPE_BYTES } from "../engine/envelope";
import type { RuntimeWakeDeliver } from "../engine/outbox";
import { inMemoryRuntimeStore } from "../adapters/memory";
import type { InMemoryRuntimeStore } from "../adapters/memory";
import type {
  InProcessRuntimeEngineDefinition,
  RuntimeWakeFactoryInput,
} from "../api/runtime-definition";
import type { RuntimeRetentionConfig } from "../engine/retention";

/** Options for the in-process Node runtime composer. */
export interface NodeRuntimeOptions<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> {
  /**
   * Store backing runtime records.
   *
   * Omit this for the process-local in-memory reference store. Supplying a
   * durable store that passes Runtime reactive conformance lets Node processes
   * share restart-safe Runtime Engine state.
   */
  readonly store?: TStore;
  /** Runtime namespace. Defaults to `local`. */
  readonly namespace?: string;
  /** Maintenance interval in milliseconds. Defaults to one second. */
  readonly maintenanceIntervalMs?: number;
  /** Start the maintenance interval when `createRuntime()` resolves this composer. */
  readonly autoStartMaintenance?: boolean;
  /** Retention policy for terminal Runtime Engine records. */
  readonly retention?: RuntimeRetentionConfig;
}

/**
 * Create the default in-process runtime using the in-memory reference store.
 *
 * @remarks The default store is process-local and cannot activate durable
 * Signal bindings. Pass a conformant durable store when restart recovery is
 * required.
 */
export function node(
  options?: Omit<NodeRuntimeOptions<InMemoryRuntimeStore>, "store">,
): InProcessRuntimeEngineDefinition<InMemoryRuntimeStore>;

/** Create an in-process runtime using a caller-supplied store adapter. */
export function node<TStore extends RuntimeStoreAdapter>(
  options: NodeRuntimeOptions<TStore> & { readonly store: TStore },
): InProcessRuntimeEngineDefinition<TStore>;

export function node<TStore extends RuntimeStoreAdapter>(
  options?: NodeRuntimeOptions<TStore>,
): InProcessRuntimeEngineDefinition<TStore | InMemoryRuntimeStore> {
  return Object.freeze({
    kind: "in-process" as const,
    id: "node",
    store: options?.store ?? inMemoryRuntimeStore(),
    capabilities: NODE_RUNTIME_CAPABILITIES,
    namespace: options?.namespace ?? "local",
    maintenance: {
      intervalMs: options?.maintenanceIntervalMs ?? 1_000,
      autoStart: options?.autoStartMaintenance ?? true,
    },
    ...(options?.retention ? { retention: options.retention } : {}),
    createWake: createMicrotaskWake,
  });
}

const NODE_RUNTIME_CAPABILITIES: CruxEngineCapabilities = Object.freeze({
  timers: Object.freeze({ durable: true }),
  wake: Object.freeze({
    atLeastOnce: true,
    signed: false,
    maxPayloadBytes: MAX_WAKE_ENVELOPE_BYTES,
  }),
  events: Object.freeze({ durable: true, cursorReads: true }),
  waiters: Object.freeze({ durable: true }),
  leases: Object.freeze({ durable: true }),
  live: Object.freeze({ available: false }),
  setup: Object.freeze({ canCheck: false, canApply: false }),
  deployment: Object.freeze({
    serverless: "unsupported",
    edge: "unsupported",
    multiProcess: "unsupported",
  }),
});

function createMicrotaskWake(
  input: RuntimeWakeFactoryInput,
): RuntimeWakeDeliver {
  return (envelope) =>
    new Promise<void>((resolve, reject) => {
      enqueueMicrotask(() => {
        void input.kernel.handleWake(envelope).then((result) => {
          if (result.status === 409) {
            reject(new Error("Runtime wake is busy."));
            return;
          }
          resolve();
        }, reject);
      });
    });
}

function enqueueMicrotask(callback: () => void): void {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return;
  }
  void Promise.resolve().then(callback);
}
