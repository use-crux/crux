/**
 * Lifecycle owner for one logical Runtime Bridge WebSocket peer.
 *
 * Reconnects retain the peer ID but create fresh command ownership. Every open
 * publishes the current prompt catalogue, so a disconnected socket never
 * replays stale capability state.
 *
 * @module
 */

import { subscribePromptCatalogue } from "../runtime/prompt-catalogue";
import { bridgeErrorMessage } from "./commands";
import type {
  RuntimeBridgeConnectOptions,
  RuntimeBridgeConnection,
  RuntimeBridgeManifest,
  RuntimeBridgeManifestInput,
  RuntimeBridgeMessage,
  RuntimeBridgeWebSocket,
  RuntimeBridgeWebSocketConstructor,
} from "./protocol";
import { createRuntimeBridgeSocketCommandHandler } from "./socket-command";

/** Construct one reconnect-capable logical peer around short-lived sockets. */
export function createRuntimeBridgeWebSocketConnection(
  input: RuntimeBridgeManifestInput,
  options: RuntimeBridgeConnectOptions,
  WebSocketImpl: RuntimeBridgeWebSocketConstructor,
  manifest: () => RuntimeBridgeManifest | undefined,
): RuntimeBridgeConnection {
  const peerId = createBridgeId("peer");
  const reconnect = reconnectPolicy(input);
  const heartbeatMs = bridgeHeartbeatMs(input);
  const now = options.now ?? (() => new Date());
  let socket: RuntimeBridgeWebSocket | undefined;
  let commandHandler:
    | ReturnType<typeof createRuntimeBridgeSocketCommandHandler>
    | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryMs = reconnect?.minMs ?? 0;
  let disposed = false;
  let opened = false;

  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
  };
  const send = (message: RuntimeBridgeMessage) => {
    if (disposed || !socket) return;
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      options.logger?.warn(
        `Crux Runtime Bridge send failed: ${bridgeErrorMessage(error)}`,
      );
    }
  };
  const sendHello = () => {
    const current = manifest();
    if (!opened || !current || current.transport !== "ws") return;
    send({
      type: "runtime.hello",
      peer: {
        peerId,
        runtimeName: current.runtimeName ?? "crux-runtime",
        environment: current.environment,
        transport: "ws",
        endpointUrl: current.url,
        labels: current.labels,
        capabilities: current.capabilities,
      },
    });
  };
  const unsubscribeCatalogue = subscribePromptCatalogue(sendHello);

  const openSocket = () => {
    if (disposed) return;
    const current = manifest();
    if (!current?.url || current.transport !== "ws") return;
    const candidate = new WebSocketImpl(current.url);
    socket = candidate;
    opened = false;
    const handler = createRuntimeBridgeSocketCommandHandler(input, send);
    commandHandler = handler;
    addSocketListener(candidate, "open", () => {
      if (disposed || socket !== candidate) return;
      opened = true;
      retryMs = reconnect?.minMs ?? 0;
      sendHello();
      heartbeat = setInterval(() => {
        send({
          type: "runtime.heartbeat",
          peerId,
          timestamp: now().toISOString(),
        });
      }, heartbeatMs);
    });
    addSocketListener(candidate, "message", handler.handle);
    addSocketListener(candidate, "error", (event) => {
      options.logger?.warn(
        `Crux Runtime Bridge socket error: ${bridgeErrorMessage(event)}`,
      );
    });
    addSocketListener(candidate, "close", () => {
      if (socket !== candidate) return;
      opened = false;
      socket = undefined;
      commandHandler = undefined;
      stopHeartbeat();
      handler.dispose();
      if (!disposed && reconnect) {
        const delay = retryMs;
        retryMs = Math.min(reconnect.maxMs, Math.max(delay * 2, delay));
        retry = setTimeout(openSocket, delay);
      }
    });
  };

  openSocket();
  return {
    peerId,
    dispose() {
      if (disposed) return;
      disposed = true;
      opened = false;
      if (retry) clearTimeout(retry);
      stopHeartbeat();
      unsubscribeCatalogue();
      commandHandler?.dispose();
      const current = socket;
      socket = undefined;
      try {
        current?.close();
      } catch {
        // ignore close failures during teardown
      }
    },
  };
}

function reconnectPolicy(
  input: RuntimeBridgeManifestInput,
): { readonly minMs: number; readonly maxMs: number } | undefined {
  const bridge = input.devtools?.bridge;
  if (!bridge || typeof bridge !== "object" || !bridge.reconnect) {
    return undefined;
  }
  const configured = bridge.reconnect;
  if (configured === true) return { minMs: 250, maxMs: 5_000 };
  const minMs = configured.minMs ?? 250;
  return { minMs, maxMs: Math.max(minMs, configured.maxMs ?? 5_000) };
}

function bridgeHeartbeatMs(input: RuntimeBridgeManifestInput): number {
  const bridge = input.devtools?.bridge;
  if (!bridge || typeof bridge !== "object") return 15_000;
  return bridge.heartbeatMs ?? 15_000;
}

function addSocketListener(
  socket: RuntimeBridgeWebSocket,
  type: "open" | "message" | "error" | "close",
  listener: (event: unknown) => void,
): void {
  if (socket.addEventListener) {
    socket.addEventListener(type, listener);
    return;
  }
  switch (type) {
    case "open":
      socket.onopen = listener;
      break;
    case "message":
      socket.onmessage = listener;
      break;
    case "error":
      socket.onerror = listener;
      break;
    case "close":
      socket.onclose = listener;
      break;
  }
}

function createBridgeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
