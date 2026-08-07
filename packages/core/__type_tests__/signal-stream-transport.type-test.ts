/**
 * Type-level coverage for managed stream transport union membership and narrowing.
 */

import { stream } from "@use-crux/core/signal/transport";
import type {
  SignalProviderTransport,
  StreamTransport,
} from "@use-crux/core/signal/transport";
import {
  isPollingTransport,
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

const transport = stream({
  async *open() {
    yield { kind: "cursor" as const, cursor: null };
  },
});

type _StreamTag = Expect<Equal<(typeof transport)["_tag"], "StreamTransport">>;
type _StreamKind = Expect<Equal<(typeof transport)["kind"], "stream">>;
type _UnionIncludesStream = Expect<
  Equal<
    SignalProviderTransport,
    | import("@use-crux/core/signal/transport").WebhookTransport
    | import("@use-crux/core/signal/transport").PollingTransport
    | StreamTransport
    | import("@use-crux/core/signal/transport").SseTransport
  >
>;

const provider = signalProvider({
  id: "orders.stream",
  transport,
  signals: { orderSubmitted },
  async onEvent() {},
});

// signalProvider widens transport to the public union (same as webhook/polling).
type _ProviderTransportIsUnion = Expect<
  Equal<(typeof provider)["transport"], SignalProviderTransport>
>;
type _StreamAssignableToUnion = Expect<
  StreamTransport extends SignalProviderTransport ? true : false
>;

declare const unknownTransport: SignalProviderTransport;

if (isStreamTransport(unknownTransport)) {
  type _NarrowedTag = Expect<
    Equal<(typeof unknownTransport)["_tag"], "StreamTransport">
  >;
  type _NarrowedOpen = Expect<
    Equal<typeof unknownTransport.open, StreamTransport["open"]>
  >;
  // @ts-expect-error Stream transport has no poll handle.
  unknownTransport.poll;
  // @ts-expect-error Stream transport has no webhook handle.
  unknownTransport.handle;
}

if (isPollingTransport(unknownTransport)) {
  // @ts-expect-error Polling transport has no open handle.
  unknownTransport.open;
}

if (isWebhookTransport(unknownTransport)) {
  // @ts-expect-error Webhook transport has no open handle.
  unknownTransport.open;
}
