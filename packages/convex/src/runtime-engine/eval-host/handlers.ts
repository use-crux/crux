import type { DeployedEvalRegistry } from "@use-crux/core/runtime/internal/eval-registry";
import { createResolvedEvalHost } from "@use-crux/core/runtime/internal/eval-host";
import {
  bindHostRuntime,
  runWithRuntimeHost,
  type InProcessRuntimeEngineDefinition,
  type RuntimeHostBinder,
  type WakeEnvelope,
} from "@use-crux/core/runtime";
import { httpActionGeneric, internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { convex } from "../definition";
import {
  createConvexWorkIdGenerator,
  decodeConvexWakeEnvelope,
} from "../helpers";
import {
  convexRuntimeStore,
  type ConvexRuntimeComponent,
  type ConvexRuntimeStore,
} from "../store";
import type { ConvexCtxPort } from "../../store";
import type { ConvexCruxStorageComponent } from "../../store-component";
import { convexStorage } from "../../storage";
import { runWithConvexCruxRuntime } from "../../runtime";

type ConvexEvalActionCtx = ConvexCtxPort & {
  scheduler: {
    runAfter(
      delayMs: number,
      ref: unknown,
      args: Record<string, unknown>,
    ): Promise<unknown>;
  };
};

type RegisteredAction<TArgs extends Record<string, unknown>, TResult> = {
  _handler?: (ctx: ConvexEvalActionCtx, args: TArgs) => Promise<TResult>;
};

type RegisteredHttpAction = {
  _handler?: (ctx: ConvexEvalActionCtx, request: Request) => Promise<Response>;
};

/** Options for the generated authenticated Convex Eval host actions. */
export interface CreateConvexEvalHostOptions {
  readonly component: ConvexRuntimeComponent &
    Partial<ConvexCruxStorageComponent>;
  readonly registry: DeployedEvalRegistry;
  readonly deploymentId: string;
  readonly token: string;
  /** Registry-required storage services supported by this deployed Convex entry. */
  readonly hostCapabilities?: readonly string[];
  /** General generated target executor used by Runtime work created inside Eval tasks. */
  readonly targetExecutor?: unknown;
  readonly now?: () => Date;
}

/** Generated Convex actions serving and executing exact deployed Eval jobs. */
export interface ConvexEvalHostActions {
  readonly handleEvalRequest: RegisteredHttpAction;
  readonly executeEvalTarget: RegisteredAction<{ envelope: unknown }, unknown>;
}

/** Create separately authenticated Convex actions for Eval host V1. */
export function createConvexEvalHost(
  options: CreateConvexEvalHostOptions,
): ConvexEvalHostActions {
  let actions!: ConvexEvalHostActions;
  const bind = (ctx: ConvexEvalActionCtx) => {
    const store = convexRuntimeStore({
      ctx,
      component: options.component,
      now: options.now,
    });
    const runtime: InProcessRuntimeEngineDefinition<ConvexRuntimeStore> =
      Object.freeze({
        kind: "in-process",
        id: "convex-eval",
        store,
        capabilities: convex().capabilities,
        createWake: () => async (envelope: WakeEnvelope) => {
          await ctx.scheduler.runAfter(0, actions.executeEvalTarget, {
            envelope,
          });
        },
        maintenance: { autoStart: false },
      });
    return createResolvedEvalHost({
      deploymentId: options.deploymentId,
      token: options.token,
      registry: options.registry,
      now: options.now,
      runtime: runtime as InProcessRuntimeEngineDefinition<
        ConvexRuntimeStore & Required<Pick<ConvexRuntimeStore, "results">>
      >,
      hostKind: "convex",
      wakeMode: "durable",
      hostCapabilities: resolveHostCapabilities(options, ctx),
    });
  };

  const hostBinder =
    (ctx: ConvexEvalActionCtx): RuntimeHostBinder =>
    (definition, runtimeOptions) =>
      bindHostRuntime(definition, {
        ...runtimeOptions,
        store: convexRuntimeStore({
          ctx,
          component: options.component,
          now: options.now,
        }),
        createWake: () => async (envelope) => {
          await ctx.scheduler.runAfter(
            0,
            options.targetExecutor ?? actions.executeEvalTarget,
            { envelope },
          );
        },
        newWorkId: runtimeOptions.newWorkId ?? createConvexWorkIdGenerator(),
        leaseExtension: false,
        startMaintenance: false,
      });

  actions = {
    handleEvalRequest: httpActionGeneric(async (ctx, request) => {
      const actionCtx = ctx as unknown as ConvexEvalActionCtx;
      const host = bind(actionCtx);
      try {
        return await host.fetch(request);
      } finally {
        host.runtime.dispose();
      }
    }) as ConvexEvalHostActions["handleEvalRequest"],
    executeEvalTarget: internalActionGeneric({
      args: { envelope: v.any() },
      returns: v.any(),
      handler: async (ctx, { envelope }) => {
        const actionCtx = ctx as unknown as ConvexEvalActionCtx;
        const host = bind(actionCtx);
        try {
          return await runWithRuntimeHost(
            { host: "convex", bind: hostBinder(actionCtx) },
            async () => {
              const execute = () =>
                host.runtime.kernel.handleWake(
                  decodeConvexWakeEnvelope(envelope),
                );
              const result = await runWithEvalStorage(
                options,
                actionCtx,
                execute,
              );
              await host.runtime.dispatcher.nudge();
              return result;
            },
          );
        } finally {
          host.runtime.dispose();
        }
      },
    }) as ConvexEvalHostActions["executeEvalTarget"],
  };
  return Object.freeze(actions);
}

function resolveHostCapabilities(
  options: CreateConvexEvalHostOptions,
  ctx: ConvexEvalActionCtx,
): readonly string[] {
  const hasStorage = isStorageComponent(options.component);
  return Object.freeze(
    [...new Set(options.hostCapabilities ?? [])]
      .filter(
        (capability) =>
          (capability === "record-store" && hasStorage) ||
          (capability === "vector-store" &&
            hasStorage &&
            typeof ctx.vectorSearch === "function"),
      )
      .sort(),
  );
}

async function runWithEvalStorage<TResult>(
  options: CreateConvexEvalHostOptions,
  ctx: ConvexEvalActionCtx,
  execute: () => Promise<TResult>,
): Promise<TResult> {
  const capabilities = resolveHostCapabilities(options, ctx);
  if (capabilities.length === 0 || !isStorageComponent(options.component))
    return await execute();
  const storage = convexStorage({ component: options.component, ctx });
  return await runWithConvexCruxRuntime(
    { ctx, storage, records: storage.records },
    execute,
  );
}

function isStorageComponent(
  component: ConvexRuntimeComponent,
): component is ConvexRuntimeComponent & ConvexCruxStorageComponent {
  const memory = (component as Partial<ConvexCruxStorageComponent>).memory;
  return (
    memory !== undefined &&
    typeof memory === "object" &&
    memory !== null &&
    ["get", "list", "set", "insert", "remove"].every((key) => key in memory)
  );
}
