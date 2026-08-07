/**
 * Provider-neutral Signal transport authoring surface.
 *
 * @module
 */

import type { PollingTransport } from "./polling";
import type { SseTransport } from "./sse";
import type { StreamTransport } from "./stream";
import type { WebhookTransport } from "./webhook";

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

/** Live transport definitions accepted by {@link import("../provider").signalProvider}. */
export type SignalProviderTransport =
  | WebhookTransport
  | PollingTransport
  | StreamTransport
  | SseTransport;
