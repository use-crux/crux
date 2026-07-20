import type { DeployedEvalRegistry } from "@use-crux/core/runtime/internal/eval-registry";
import { createResolvedEvalHost } from "@use-crux/core/runtime/internal/eval-host";
import {
  bindHostRuntime,
  runWithRuntimeHost,
  type InProcessRuntimeEngineDefinition,
  type RuntimeHostBinder,
  type WakeEnvelope,
} from "@use-crux/core/runtime";
import { internalActionGeneric } from "convex/server";
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
import type {
  ConvexEvalHttpRequest,
  ConvexEvalHttpResponse,
} from "./http-action";

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

/** Options for the generated authenticated Convex Eval host actions. */
export interface CreateConvexEvalHostOptions {
  readonly component: ConvexRuntimeComponent &
    Partial<ConvexCruxStorageComponent>;
  readonly registry: DeployedEvalRegistry;
  readonly deploymentId: string;
  readonly token?: string;
  /** Registry-required storage services supported by this deployed Convex entry. */
  readonly hostCapabilities?: readonly string[];
  /** General generated target executor used by Runtime work created inside Eval tasks. */
  readonly targetExecutor?: unknown;
  readonly now?: () => Date;
}

/** Generated Convex actions serving and executing exact deployed Eval jobs. */
export interface ConvexEvalHostActions {
  readonly handleEvalRequest: RegisteredAction<
    { request: ConvexEvalHttpRequest },
    ConvexEvalHttpResponse
  >;
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
      token: options.token ?? "",
      registry: options.registry,
      now: options.now,
      runtime: runtime as InProcessRuntimeEngineDefinition<
        ConvexRuntimeStore & Required<Pick<ConvexRuntimeStore, "results">>
      >,
      hostKind: "convex",
      wakeMode: "durable",
      hostCapabilities: resolveHostCapabilities(options),
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
    handleEvalRequest: internalActionGeneric({
      args: {
        request: v.object({
          url: v.string(),
          method: v.string(),
          headers: v.array(v.object({ name: v.string(), value: v.string() })),
          body: v.bytes(),
        }),
      },
      returns: v.object({
        status: v.number(),
        statusText: v.string(),
        headers: v.array(v.object({ name: v.string(), value: v.string() })),
        body: v.bytes(),
      }),
      handler: async (ctx, { request }) => {
        if (!options.token) return await evalHostSetupRequiredResponse();
        const actionCtx = ctx as unknown as ConvexEvalActionCtx;
        const host = bind(actionCtx);
        try {
          const response = await host.fetch(requestFromEnvelope(request));
          return await responseEnvelope(response);
        } finally {
          host.runtime.dispose();
        }
      },
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

async function evalHostSetupRequiredResponse(): Promise<ConvexEvalHttpResponse> {
  return await responseEnvelope(
    new Response(
      JSON.stringify({
        error: {
          code: "EVAL_HOST_SETUP_REQUIRED",
          message:
            "Crux Eval hosting is not configured for this Convex deployment.",
          nextStep:
            "Set CRUX_EVAL_HOST_TOKEN in this Convex deployment and in the environment that runs Crux Evals.",
        },
      }),
      {
        status: 503,
        headers: { "content-type": "application/json" },
      },
    ),
  );
}

async function responseEnvelope(
  response: Response,
): Promise<ConvexEvalHttpResponse> {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()].map(([name, value]) => ({
      name,
      value,
    })),
    body: await response.arrayBuffer(),
  };
}

function requestFromEnvelope(request: ConvexEvalHttpRequest): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers.map(({ name, value }): [string, string] => [
      name,
      value,
    ]),
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
  });
}

function resolveHostCapabilities(
  options: CreateConvexEvalHostOptions,
): readonly string[] {
  const hasStorage = isStorageComponent(options.component);
  return Object.freeze(
    [...new Set(options.hostCapabilities ?? [])]
      .filter((capability) => capability === "record-store" && hasStorage)
      .sort(),
  );
}

async function runWithEvalStorage<TResult>(
  options: CreateConvexEvalHostOptions,
  ctx: ConvexEvalActionCtx,
  execute: () => Promise<TResult>,
): Promise<TResult> {
  const capabilities = resolveHostCapabilities(options);
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
