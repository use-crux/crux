/**
 * `@use-crux/cloudflare` — Durable Object hosting for deployed Crux Evals.
 *
 * @module
 */

import type { DeployedEvalRegistry } from "@use-crux/core/runtime/internal/eval-registry";
import {
  createResolvedEvalHost,
  type EvalHostStore,
  type ResolvedEvalHost,
} from "@use-crux/core/runtime/internal/eval-host";
import type {
  HostBoundRuntimeEngineDefinition,
  InProcessRuntimeEngineDefinition,
  RuntimeHostBinder,
  RuntimeHostBindingOptions,
  RuntimeTargetMap,
  RuntimeHandlerTarget,
  RuntimeTargetRuntimeRef,
  RuntimeResultPayloadPort,
  WakeEnvelope,
} from "@use-crux/core/runtime";
import {
  bindHostRuntime,
  normalizeRuntimeHandlerTargets,
  runWithRuntimeHost,
} from "@use-crux/core/runtime";
import { createCloudflareRuntimeStore } from "./runtime/store";
import { CLOUDFLARE_RUNTIME_CAPABILITIES } from "./runtime/definition";

export { CLOUDFLARE_RUNTIME_ENTRY, cloudflare } from "./runtime/definition";
export { workers } from "./workers";
export type {
  WorkersExecutionContext,
  WorkersHostBindingOptions,
} from "./workers";
export type {
  CloudflareRuntimeEngineDefinition,
  CloudflareRuntimeEngineOptions,
} from "./runtime/definition";

/** Environment keys whose values are Durable Object namespaces. */
export type DurableObjectBindingKey<TEnv> = Extract<
  {
    [TKey in keyof TEnv]-?: TEnv[TKey] extends DurableObjectNamespace
      ? TKey
      : never;
  }[keyof TEnv],
  string
>;

/** Configuration captured by one generated Cloudflare Eval host entry. */
export interface CreateCloudflareEvalHostOptions<TEnv> {
  /** Durable Object namespace binding exported by the Worker. */
  readonly binding: DurableObjectBindingKey<TEnv>;
  /** Stable deployment identity used for the singleton Durable Object. */
  readonly deploymentId: string;
  /** Generated allowlist of executable deployed Evals. */
  readonly registry: DeployedEvalRegistry;
  /** Resolve the dedicated Eval-execute bearer from Worker bindings. */
  readonly token: (env: TEnv) => string;
  /** Bounded admission and polling limits. */
  readonly limits?: Readonly<{
    readonly maxConcurrentJobs?: number;
    readonly maxPollsPerSecond?: number;
  }>;
  /** Durable services available to deployed managed tasks. */
  readonly hostCapabilities?: readonly string[];
  /** Deterministic clock override for tests. */
  readonly now?: () => Date;
  /** Generated Runtime targets deployed in this Worker entry. */
  readonly targets?: readonly RuntimeHandlerTarget[];
  /**
   * Explicit alternate result payload storage, such as an R2-backed port.
   * The default chunks canonical payloads inside Durable Object storage.
   */
  readonly resultPayloads?: (input: {
    readonly state: DurableObjectState;
    readonly env: TEnv;
  }) => RuntimeResultPayloadPort;
}

/** Worker router and Durable Object class produced for a generated entry. */
export interface CloudflareEvalHost<TEnv> {
  /** Durable Object class to export from the Worker module. */
  readonly DurableObject: new (
    state: DurableObjectState,
    env: TEnv,
  ) => CloudflareEvalHostObject;
  /** Route authenticated Eval traffic to the deployment's singleton object. */
  fetch(request: Request, env: TEnv): Promise<Response>;
}

/** Fetch/alarm surface implemented by the generated Durable Object class. */
export interface CloudflareEvalHostObject {
  fetch(request: Request): Promise<Response>;
  alarm(): Promise<void>;
}

/**
 * Define a singleton Durable Object Eval host and its Worker-facing router.
 *
 * Export `host.DurableObject` under the class name configured in Wrangler and
 * delegate the Worker's `fetch` handler to `host.fetch`.
 */
export function createCloudflareEvalHost<TEnv>(
  options: CreateCloudflareEvalHostOptions<TEnv>,
): CloudflareEvalHost<TEnv> {
  class CruxCloudflareEvalHost implements CloudflareEvalHostObject {
    readonly #host: ResolvedEvalHost<EvalHostStore>;
    readonly #store: EvalHostStore;
    readonly #bindRuntimeHost: RuntimeHostBinder;
    readonly #targets: RuntimeTargetMap;

    constructor(
      readonly state: DurableObjectState,
      env: TEnv,
    ) {
      this.#store = createCloudflareRuntimeStore(state.storage, {
        ...(options.resultPayloads
          ? { results: options.resultPayloads({ state, env }) }
          : {}),
      });
      const runtimeRef: RuntimeTargetRuntimeRef = {};
      this.#targets = normalizeRuntimeHandlerTargets({
        targets: options.targets ?? [],
        runtimeRef,
        entry: "generated Cloudflare Eval host",
      });
      const runtime: InProcessRuntimeEngineDefinition<EvalHostStore> = {
        kind: "in-process",
        id: "cloudflare-eval",
        store: this.#store,
        capabilities: CLOUDFLARE_RUNTIME_CAPABILITIES,
        maintenance: { autoStart: false },
        createWake: () => async () => {
          if ((await state.storage.getAlarm()) === null) {
            await state.storage.setAlarm(Date.now() + 1_000);
          }
        },
      };
      this.#host = createResolvedEvalHost({
        deploymentId: options.deploymentId,
        token: options.token(env),
        registry: options.registry,
        ...(options.limits ? { limits: options.limits } : {}),
        ...(options.hostCapabilities
          ? { hostCapabilities: options.hostCapabilities }
          : {}),
        ...(options.now ? { now: options.now } : {}),
        runtime,
        hostKind: "cloudflare",
        wakeMode: "durable",
        leaseExtension: false,
        targets: this.#targets,
      });
      runtimeRef.current = this.#host.runtime;
      this.#bindRuntimeHost = (
        definition: HostBoundRuntimeEngineDefinition,
        runtimeOptions: RuntimeHostBindingOptions,
      ) =>
        bindHostRuntime(definition, {
          ...runtimeOptions,
          store: this.#store,
          createWake: runtime.createWake,
          targets: { ...this.#targets, ...runtimeOptions.targets },
          leaseExtension: false,
          startMaintenance: false,
        });
    }

    async fetch(request: Request): Promise<Response> {
      return await this.#host.fetch(request);
    }

    async alarm(): Promise<void> {
      for (const namespace of await this.#activeNamespaces()) {
        for (let pass = 0; pass < 4; pass += 1) {
          const result = await this.#host.runtime.kernel.maintenanceTick({
            namespace,
            now: new Date(),
            deliver: (envelope) => this.#deliver(envelope),
          });
          if (
            result.leasesReclaimed === 0 &&
            result.timersFired === 0 &&
            result.pendingRequeued === 0
          ) {
            break;
          }
        }
      }
      await this.#scheduleNextAlarm();
    }

    async #deliver(envelope: WakeEnvelope): Promise<void> {
      const result = await runWithRuntimeHost(
        { host: "cloudflare", bind: this.#bindRuntimeHost },
        () => this.#host.runtime.kernel.handleWake(envelope),
      );
      if (result.status !== 200 || result.outcome === "lease-lost") {
        throw new Error(
          `Cloudflare Runtime wake requires redelivery (${result.outcome}).`,
        );
      }
    }

    async #activeNamespaces(): Promise<readonly string[]> {
      const namespaces = new Set([this.#host.runtime.namespace]);
      for (const prefix of [
        "work:",
        "outbox:",
        "timer:",
        "waiter:",
        "deferred-scope:",
        "deferred-intent:",
      ]) {
        const rows = await this.state.storage.list<{ namespace?: unknown }>({
          prefix,
        });
        for (const row of rows.values()) {
          if (typeof row.namespace === "string") namespaces.add(row.namespace);
        }
      }
      return [...namespaces].sort();
    }

    async #scheduleNextAlarm(): Promise<void> {
      const timers = await this.state.storage.list<{
        state: string;
        fireAt: Date;
      }>({ prefix: "timer:" });
      const outbox = await this.state.storage.list<{
        state: string;
        nextAttemptAt: Date;
      }>({ prefix: "outbox:" });
      const deadlines = [
        ...[...timers.values()]
          .filter((timer) => timer.state === "scheduled")
          .map((timer) => timer.fireAt.getTime()),
        ...[...outbox.values()]
          .filter((item) => item.state !== "confirmed")
          .map((item) => item.nextAttemptAt.getTime()),
      ];
      if (deadlines.length > 0) {
        await this.state.storage.setAlarm(
          Math.max(Date.now() + 1, Math.min(...deadlines)),
        );
      }
    }
  }

  return Object.freeze({
    DurableObject: CruxCloudflareEvalHost,
    async fetch(request: Request, env: TEnv): Promise<Response> {
      const namespace = env[options.binding] as DurableObjectNamespace;
      const object = namespace.get(namespace.idFromName(options.deploymentId));
      return await object.fetch(request);
    },
  });
}
