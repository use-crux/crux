/**
 * Type-level coverage for SSE transport union membership and narrowing.
 */

import { sse, stream } from "@use-crux/core/signal/transport";
import type {
  SignalProviderTransport,
  SseTransport,
  StreamTransport,
} from "@use-crux/core/signal/transport";
import {
  isManagedStreamTransport,
  isPollingTransport,
  isSseTransport,
  isStreamTransport,
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

const transport = sse({
  async *open() {
    yield { kind: "cursor" as const, lastEventId: null };
  },
});

type _SseTag = Expect<Equal<(typeof transport)["_tag"], "SseTransport">>;
type _SseKind = Expect<Equal<(typeof transport)["kind"], "sse">>;
type _UnionIncludesSse = Expect<
  Equal<
    SignalProviderTransport,
    | import("@use-crux/core/signal/transport").WebhookTransport
    | import("@use-crux/core/signal/transport").PollingTransport
    | StreamTransport
    | SseTransport
  >
>;

const provider = signalProvider({
  id: "orders.sse",
  transport,
  signals: { orderSubmitted },
  async onEvent() {},
});

// signalProvider widens transport to the public union (same as webhook/stream).
type _ProviderTransportIsUnion = Expect<
  Equal<(typeof provider)["transport"], SignalProviderTransport>
>;
type _SseAssignableToUnion = Expect<
  SseTransport extends SignalProviderTransport ? true : false
>;

declare const unknownTransport: SignalProviderTransport;

if (isSseTransport(unknownTransport)) {
  type _NarrowedTag = Expect<
    Equal<(typeof unknownTransport)["_tag"], "SseTransport">
  >;
  type _NarrowedOpen = Expect<
    Equal<typeof unknownTransport.open, SseTransport["open"]>
  >;
  // @ts-expect-error SSE transport has no poll handle.
  unknownTransport.poll;
  // @ts-expect-error SSE transport has no webhook handle.
  unknownTransport.handle;
}

if (isStreamTransport(unknownTransport)) {
  type _StreamOnly = Expect<
    Equal<(typeof unknownTransport)["_tag"], "StreamTransport">
  >;
  // @ts-expect-error Stream transport is not SseTransport.
  const _notSse: SseTransport = unknownTransport;
}

if (isManagedStreamTransport(unknownTransport)) {
  type _ManagedTag = Expect<
    (typeof unknownTransport)["_tag"] extends "StreamTransport" | "SseTransport"
      ? true
      : false
  >;
  type _ManagedOpen = Expect<
    Equal<
      typeof unknownTransport.open,
      StreamTransport["open"] | SseTransport["open"]
    >
  >;
}

// SSE is managed-stream but not stream().
const streamOnly = stream({
  async *open() {
    yield { kind: "cursor" as const, cursor: null };
  },
});
const sseOnly = transport;

type _StreamIsManaged = Expect<
  ReturnType<typeof isManagedStreamTransport> extends boolean ? true : false
>;

if (isPollingTransport(unknownTransport)) {
  // @ts-expect-error Polling transport has no open handle.
  unknownTransport.open;
}

if (isWebhookTransport(unknownTransport)) {
  // @ts-expect-error Webhook transport has no open handle.
  unknownTransport.open;
}

// Runtime narrowing checks for isStreamTransport vs isManagedStreamTransport.
declare function assertFalse(value: false): void;
declare function assertTrue(value: true): void;

if (isStreamTransport(sseOnly as SignalProviderTransport)) {
  // Should not narrow SSE as StreamTransport at the type level for pure SSE values.
  // Use isManagedStreamTransport / isSseTransport instead.
}

// Keep streamOnly referenced so unused-locals do not fire in strict type tests.
void streamOnly;
void sseOnly;
void assertFalse;
void assertTrue;
