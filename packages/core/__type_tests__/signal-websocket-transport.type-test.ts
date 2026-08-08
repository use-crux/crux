/**
 * Type-level coverage for WebSocket transport union membership and narrowing.
 */

import { stream, websocket } from "@use-crux/core/signal/transport";
import type {
  SignalProviderTransport,
  StreamTransport,
  WebSocketTransport,
} from "@use-crux/core/signal/transport";
import {
  isManagedStreamTransport,
  isPollingTransport,
  isSseTransport,
  isStreamTransport,
  isWebSocketTransport,
  isWebhookTransport,
  signalProvider,
} from "@use-crux/core/signal/provider";
import { signal } from "@use-crux/core/signal";
import { z } from "zod";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
    Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

const orderSubmitted = signal({
  id: "order.submitted",
  schema: z.object({ orderId: z.string() }),
});

const transport = websocket({
  async *open() {
    yield { kind: "cursor" as const, cursor: null };
  },
});

type _WsTag = Expect<Equal<(typeof transport)["_tag"], "WebSocketTransport">>;
type _WsKind = Expect<Equal<(typeof transport)["kind"], "websocket">>;
type _UnionIncludesWs = Expect<
  Equal<
    SignalProviderTransport,
    | import("@use-crux/core/signal/transport").WebhookTransport
    | import("@use-crux/core/signal/transport").PollingTransport
    | StreamTransport
    | import("@use-crux/core/signal/transport").SseTransport
    | WebSocketTransport
  >
>;

const provider = signalProvider({
  id: "orders.ws",
  transport,
  signals: { orderSubmitted },
  async onEvent() {},
});

type _ProviderTransportIsUnion = Expect<
  Equal<(typeof provider)["transport"], SignalProviderTransport>
>;
type _WsAssignableToUnion = Expect<
  WebSocketTransport extends SignalProviderTransport ? true : false
>;

declare const unknownTransport: SignalProviderTransport;

if (isWebSocketTransport(unknownTransport)) {
  type _NarrowedTag = Expect<
    Equal<(typeof unknownTransport)["_tag"], "WebSocketTransport">
  >;
  type _NarrowedOpen = Expect<
    Equal<typeof unknownTransport.open, WebSocketTransport["open"]>
  >;
  // @ts-expect-error WebSocket transport has no poll handle.
  unknownTransport.poll;
  // @ts-expect-error WebSocket transport has no webhook handle.
  unknownTransport.handle;
}

if (isStreamTransport(unknownTransport)) {
  type _StreamOnly = Expect<
    Equal<(typeof unknownTransport)["_tag"], "StreamTransport">
  >;
  // @ts-expect-error Stream transport is not WebSocketTransport.
  const _notWs: WebSocketTransport = unknownTransport;
}

if (isManagedStreamTransport(unknownTransport)) {
  type _ManagedTag = Expect<
    (typeof unknownTransport)["_tag"] extends
      | "StreamTransport"
      | "SseTransport"
      | "WebSocketTransport"
      ? true
      : false
  >;
}

if (isSseTransport(unknownTransport)) {
  // @ts-expect-error SSE is not WebSocket.
  const _notWs: WebSocketTransport = unknownTransport;
}

if (isPollingTransport(unknownTransport)) {
  // @ts-expect-error Polling transport has no open handle.
  unknownTransport.open;
}

if (isWebhookTransport(unknownTransport)) {
  // @ts-expect-error Webhook transport has no open handle.
  unknownTransport.open;
}

const streamOnly = stream({
  async *open() {
    yield { kind: "cursor" as const, cursor: null };
  },
});
const wsOnly = transport;

if (isStreamTransport(wsOnly)) {
  const unreachable: never = wsOnly;
  void unreachable;
}

// Optional acknowledge is allowed on envelope items.
void websocket({
  async *open() {
    yield {
      kind: "envelope" as const,
      accountId: "a",
      eventId: "e",
      authenticatedRouting: {},
      payload: {
        kind: "inline-base64url" as const,
        value: "YQ",
        byteLength: 1,
        sha256:
          "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
      },
      cursor: "c1",
      acknowledge: async () => undefined,
    };
  },
});

void streamOnly;
void wsOnly;
void provider;
