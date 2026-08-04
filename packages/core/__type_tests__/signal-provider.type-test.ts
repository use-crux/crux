import { z } from "zod";
import { signal } from "@use-crux/core/signal";
import { webhook } from "@use-crux/core/signal/transport";
import {
  managedTransportBinding,
  signalProvider,
} from "@use-crux/core/signal/provider";
import type { RuntimeManagedTransportBinding } from "@use-crux/core/runtime";

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

const invoicePaid = signal({
  id: "invoice.paid",
  schema: z.object({ invoiceId: z.string() }),
});

const transport = webhook({
  async handle() {
    return {
      accountId: "acct_1",
      eventId: "evt_1",
      authenticatedRouting: { source: "webhook" },
      payload: {
        kind: "inline-base64url",
        value: "YQ",
        byteLength: 1,
        sha256:
          "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
      },
    };
  },
});

const provider = signalProvider({
  id: "orders.webhook",
  transport,
  signals: {
    orderSubmitted,
    invoicePaid,
  },
  async onEvent(_envelope, { signals }) {
    type _OrderId = Expect<
      Equal<(typeof signals.orderSubmitted)["id"], "order.submitted">
    >;
    type _InvoiceId = Expect<
      Equal<(typeof signals.invoicePaid)["id"], "invoice.paid">
    >;
    // @ts-expect-error Only declared Signals are available on the provider map.
    signals.missingSignal;
    await signals.orderSubmitted.publish({ orderId: "ord_1" });
    // @ts-expect-error Payload must match the declared Signal schema input.
    await signals.orderSubmitted.publish({ invoiceId: "inv_1" });
  },
});

type _ProviderId = Expect<Equal<(typeof provider)["id"], "orders.webhook">>;
type _SignalsExact = Expect<
  Equal<
    keyof (typeof provider)["signals"],
    "orderSubmitted" | "invoicePaid"
  >
>;
type _OrderSignalExact = Expect<
  Equal<(typeof provider.signals.orderSubmitted)["id"], "order.submitted">
>;
type _InvoiceSignalExact = Expect<
  Equal<(typeof provider.signals.invoicePaid)["id"], "invoice.paid">
>;

signalProvider({
  id: "orders.invalid",
  transport,
  signals: {
    orderSubmitted,
    // @ts-expect-error Non-Signal map values are rejected at the authoring site.
    notASignal: { orderId: "ord_1" },
  },
  async onEvent() {},
});

signalProvider({
  id: "orders.lookalike",
  transport,
  signals: {
    // @ts-expect-error Structural lookalikes without Signal methods are rejected.
    orderSubmitted: {
      _tag: "Signal" as const,
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    },
  },
  async onEvent() {},
});

const binding = managedTransportBinding(provider, {
  id: "binding.orders",
  configRef: { id: "config.orders", revision: "rev.1" },
  signalId: "order.submitted",
});

type _BindingExact = Expect<
  Equal<typeof binding, RuntimeManagedTransportBinding>
>;
type _BindingIdLiteral = Expect<Equal<(typeof binding)["id"], string>>;

// @ts-expect-error Inert bindings never capture live handler fields.
binding.handle;
// @ts-expect-error Inert bindings never capture provider callbacks.
binding.onEvent;
