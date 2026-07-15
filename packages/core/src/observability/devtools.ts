/**
 * Local canonical observability transport.
 *
 * Configures the prompts library to send canonical graph records to the
 * Crux devtools server via HTTP POST.
 *
 * Works in ephemeral runtimes like Convex actions — no long-lived
 * connections required. Events are fire-and-forget.
 *
 * **Usage:**
 * ```ts
 * import { config } from '@use-crux/core'
 *
 * // Only when application runtime code should send records to a known local
 * // devtools server or tunnel. Quality CLI runs auto-attach locally.
 * config({
 *   devtools: { serverUrl: process.env.DEVTOOLS_URL },
 * })
 * ```
 *
 * @module
 */

import type { z } from "zod";
import type { FlowToolDef } from "../types";
import type { AnyPrompt } from "../prompt/prompt-types";
import type { Context } from "../prompt/context-types";
import type { CruxPlugin, CruxPluginResult } from "../runtime/plugin";
import type { RuntimeBridgeOptions } from "../runtime-bridge";
import {
  getHooks,
  pushHooksLayer,
  restoreHooksLayer,
  type CruxHooks,
  type HooksLayerToken,
} from "../runtime/runtime";
import { configureObservability, observe } from "./observe";
import { createHttpObservabilityTransport } from "./transport";
import { IndexSnapshotSchema } from "../project-index";
import { serializeIndex } from "../project-index/serializers";
import { createProjectIndexRuntimeTransport } from "../project-index/runtime";

export interface EnableDevtoolsOptions {
  /** Prompt instances to register in the devtools index. */
  prompts: AnyPrompt[];
  /** Context instances to register (contexts used by prompts are auto-included). */
  contexts?: Context<z.ZodType>[];
  /**
   * URL of the local devtools server or tunnel.
   *
   * This is a development visibility channel. Production telemetry/export
   * belongs in explicit observability or telemetry plugin configuration.
   *
   * Accepts http://, https://, ws://, or wss:// — automatically normalized.
   * @default 'http://localhost:4400'
   */
  serverUrl?: string;
  /**
   * Enable the Runtime Bridge command plane.
   *
   * `true` uses the core default WS peer for long-lived local Node runtimes.
   * Framework integrations such as `@use-crux/convex` can register HTTP bridge
   * endpoints from their setup helpers. Explicit bridge config wins.
   */
  bridge?: RuntimeBridgeOptions;
  /**
   * Namespace paths from tree builders (id → path segments).
   * When provided, the index includes tree structure for the devtools UI.
   * Set automatically by `configure()` when trees are passed.
   */
  paths?: Map<string, string[]>;
  /**
   * Optional session ID for grouping traces into logical sessions.
   * All traces emitted while this devtools instance is active will carry this ID.
   */
  sessionId?: string;
  /** Tool definitions to register in the devtools index. */
  tools?: FlowToolDef[];
}

/**
 * Create a devtools plugin for use with `config({ plugins: [...] })`.
 *
 * Returns a `CruxPlugin` that installs the canonical graph transport.
 *
 * @param options - Prompts, contexts, and server URL to register.
 * @returns A `CruxPlugin` that can be passed to `config({ plugins: [...] })`.
 *
 * @example
 * ```ts
 * import { config } from '@use-crux/core'
 *
 * config({
 *   devtools: { serverUrl: process.env.DEVTOOLS_URL },
 * })
 * ```
 */
export function withDevtools(options: EnableDevtoolsOptions): CruxPlugin {
  return {
    name: "crux:devtools",
    install(hooks) {
      return buildDevtoolsRuntime(options, hooks);
    },
  };
}

interface DevtoolsRuntimeLayer {
  layerToken: HooksLayerToken;
  dispose: () => void | Promise<void>;
  parentToken: number;
}

let nextDevtoolsToken = 1;
let activeDevtoolsToken = 0;
const devtoolsRuntimeLayers = new Map<number, DevtoolsRuntimeLayer>();

/**
 * Enable devtools instrumentation.
 *
 * - Configures the canonical graph HTTP transport
 * - Leaves primitive tracing to the built-in canonical observability emitters
 * - Does not install the legacy collector trace middleware
 *
 * @param options - Prompts, contexts, and optional server URL to register.
 * @returns A cleanup function that restores the previous observability transport.
 */
/**
 * Build the devtools runtime patch — shared between `withDevtools()` and `enableDevtools()`.
 *
 * Creates the canonical graph transport and returns it as a runtime patch.
 */
function buildDevtoolsRuntime(
  options: EnableDevtoolsOptions,
  _existingRuntime: Readonly<CruxHooks>,
): CruxPluginResult {
  const transport = createHttpObservabilityTransport({
    serverUrl: options.serverUrl,
  });
  const restoreObservability = configureObservability({
    transport,
    ...(options.sessionId
      ? { defaultCorrelators: { sessionId: options.sessionId } }
      : {}),
  });
  const snapshotRegistration = registerIndexSnapshot(options);
  const projectIndexRuntimeTransport = createProjectIndexRuntimeTransport({
    deliver: async (update, { signal }) => {
      await snapshotRegistration;
      const fetchImpl = globalThis.fetch;
      if (!fetchImpl) throw new Error("fetch unavailable");
      const response = await fetchImpl(
        joinUrl(
          options.serverUrl ?? "http://localhost:4400",
          "/api/index/runtime-update",
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Bypass-Tunnel-Reminder": "true",
          },
          body: JSON.stringify(update),
          signal,
        },
      );
      if (!response.ok) {
        throw new Error(
          `Project Index runtime update returned HTTP ${response.status}`,
        );
      }
    },
    onDeliveryError() {
      if (typeof console !== "undefined") {
        console.warn("[crux] project index runtime update delivery failed");
      }
    },
  });

  return {
    observabilityTransport: transport,
    projectIndexRuntimeTransport,
    dispose() {
      const flushed = Promise.all([
        observe.flush({ timeoutMs: 2000 }),
        projectIndexRuntimeTransport.flush({ timeoutMs: 2000 }),
      ]);
      restoreObservability();
      return flushed.then(() => undefined);
    },
  };
}

function normalizeServerUrl(serverUrl: string): string {
  if (serverUrl.startsWith("ws://"))
    return `http://${serverUrl.slice("ws://".length)}`;
  if (serverUrl.startsWith("wss://"))
    return `https://${serverUrl.slice("wss://".length)}`;
  return serverUrl;
}

function joinUrl(serverUrl: string, endpoint: string): string {
  return `${normalizeServerUrl(serverUrl).replace(/\/+$/u, "")}/${endpoint.replace(/^\/+/u, "")}`;
}

async function registerIndexSnapshot(
  options: EnableDevtoolsOptions,
): Promise<void> {
  const fetchImpl = globalThis.fetch;
  if (!fetchImpl) return;

  const snapshot = IndexSnapshotSchema.parse({
    schemaVersion: 1,
    ...serializeIndex(
      options.prompts,
      options.contexts ?? [],
      options.paths,
      options.tools,
    ),
  });

  try {
    const response = await fetchImpl(
      joinUrl(
        options.serverUrl ?? "http://localhost:4400",
        "/api/index/snapshot",
      ),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Bypass-Tunnel-Reminder": "true",
        },
        body: JSON.stringify(snapshot),
      },
    );
    if (!response.ok && typeof console !== "undefined") {
      console.warn(
        `[crux] devtools index registration failed with HTTP ${response.status}`,
      );
    }
  } catch (error) {
    if (typeof console !== "undefined") {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[crux] devtools index registration failed: ${message}`);
    }
  }
}

export function enableDevtools(options: EnableDevtoolsOptions): () => void {
  const token = nextDevtoolsToken++;
  const previousRuntime = getHooks();

  const { dispose, ...runtimePatch } = buildDevtoolsRuntime(
    options,
    previousRuntime,
  );
  const layerToken = pushHooksLayer(runtimePatch);
  devtoolsRuntimeLayers.set(token, {
    layerToken,
    dispose: dispose ?? (() => undefined),
    parentToken: activeDevtoolsToken,
  });
  activeDevtoolsToken = token;

  return () => disableDevtools(token);
}

/**
 * Disable devtools instrumentation and restore previous state.
 *
 * Restores the runtime state captured by the active enable token. If an older
 * token is disabled while newer tokens are active, those descendant layers are
 * disposed first and invalidated with the parent restore.
 */
export function disableDevtools(token = activeDevtoolsToken): void {
  if (token === 0) return;

  const layer = devtoolsRuntimeLayers.get(token);
  if (!layer || !isActiveDevtoolsLayer(token)) return;

  const tokensToDispose = activeDevtoolsTokensThrough(token);
  for (const activeToken of tokensToDispose) {
    const activeLayer = devtoolsRuntimeLayers.get(activeToken);
    if (!activeLayer) continue;
    void activeLayer.dispose();
    restoreHooksLayer(activeLayer.layerToken);
    devtoolsRuntimeLayers.delete(activeToken);
  }

  activeDevtoolsToken = layer.parentToken;
}

function isActiveDevtoolsLayer(token: number): boolean {
  for (let currentToken = activeDevtoolsToken; currentToken !== 0; ) {
    if (currentToken === token) return true;
    currentToken = devtoolsRuntimeLayers.get(currentToken)?.parentToken ?? 0;
  }
  return false;
}

function activeDevtoolsTokensThrough(token: number): number[] {
  const tokens: number[] = [];
  for (let currentToken = activeDevtoolsToken; currentToken !== 0; ) {
    tokens.push(currentToken);
    if (currentToken === token) return tokens;
    currentToken = devtoolsRuntimeLayers.get(currentToken)?.parentToken ?? 0;
  }
  return [];
}
