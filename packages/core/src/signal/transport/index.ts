/**
 * Provider-neutral Signal transport authoring surface.
 *
 * @module
 */

import type { PollingTransport } from "./polling";
import type { SseTransport } from "./sse";
import type { StreamTransport } from "./stream";
import type { WebhookTransport } from "./webhook";
import type { WebSocketTransport } from "./websocket";

export { webhook } from "./webhook";
export type {
  WebhookHandle,
  WebhookHandleResult,
  WebhookOptions,
  WebhookTransport,
} from "./webhook";

export { polling } from "./polling";
export type {
  PollContext,
  PollEvent,
  PollHandle,
  PollingOptions,
  PollingTransport,
  PollResult,
} from "./polling";

export { stream } from "./stream";
export type {
  StreamCursorItem,
  StreamEnvelopeAcknowledge,
  StreamEnvelopeItem,
  StreamItem,
  StreamOpen,
  StreamOpenContext,
  StreamOptions,
  StreamTransport,
} from "./stream";

export { sse } from "./sse";
export type {
  SseCursorItem,
  SseEnvelopeItem,
  SseItem,
  SseOpen,
  SseOpenContext,
  SseOptions,
  SseTransport,
} from "./sse";

export { lowerSseItem, lowerSseOpen } from "./sse-lower";

export {
  classifySseHttpStatus,
  sseHttpStatusErrorCode,
} from "./sse-http-status";
export type { SseHttpStatusKind } from "./sse-http-status";

export { websocket } from "./websocket";
export type {
  WebSocketAcknowledge,
  WebSocketCursorItem,
  WebSocketEnvelopeItem,
  WebSocketItem,
  WebSocketOpen,
  WebSocketOpenContext,
  WebSocketOptions,
  WebSocketTransport,
} from "./websocket";

export { lowerWebSocketItem, lowerWebSocketOpen } from "./websocket-lower";

export {
  classifyWebSocketCloseCode,
  webSocketCloseErrorCode,
} from "./websocket-close";
export type { WebSocketCloseKind } from "./websocket-close";

export {
  createBoundedPushBuffer,
  TRANSPORT_PUSH_BUFFER_OVERFLOW,
} from "./bounded-push-buffer";
export type {
  BoundedPushBuffer,
  BoundedPushBufferOptions,
} from "./bounded-push-buffer";

/** Live transport definitions accepted by {@link import("../provider").signalProvider}. */
export type SignalProviderTransport =
  | WebhookTransport
  | PollingTransport
  | StreamTransport
  | SseTransport
  | WebSocketTransport;
