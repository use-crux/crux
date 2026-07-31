import { expectTypeOf } from "vitest";
import { z } from "zod";
import { flow, signal } from "@use-crux/core";
import type {
  InferSignalSchemaInput,
  InferSignalSchemaOutput,
  MatchSignalView,
  PredicateSignalView,
  Signal,
  SignalListener,
  SignalMatch,
  SignalOccurrence,
  SignalPublishReceipt,
} from "@use-crux/core/signal";

type ExpectFalse<T extends false> = T;
type Extends<TValue, TTarget> = [TValue] extends [TTarget] ? true : false;

const orderSubmittedSchema = z.object({ orderId: z.string() });
const orderSubmitted = signal({
  id: "order.submitted",
  schema: orderSubmittedSchema,
});

expectTypeOf(orderSubmitted).toEqualTypeOf<
  Signal<"order.submitted", typeof orderSubmittedSchema>
>();

const predicateView = orderSubmitted.when(
  (payload) => payload.orderId === "order_123",
);
const matchView = orderSubmitted.when({ orderId: "order_123" });
expectTypeOf(predicateView).toEqualTypeOf<
  PredicateSignalView<"order.submitted", typeof orderSubmittedSchema>
>();
expectTypeOf(matchView).toEqualTypeOf<
  MatchSignalView<"order.submitted", typeof orderSubmittedSchema>
>();
expectTypeOf(predicateView.filterKind).toEqualTypeOf<"predicate">();
expectTypeOf(matchView.filterKind).toEqualTypeOf<"match">();

// @ts-expect-error Filtered views cannot publish occurrences.
predicateView.publish({ orderId: "order_123" });
// @ts-expect-error Filtered views cannot subscribe process-local listeners.
matchView.subscribe(() => undefined);
// @ts-expect-error Filtered views cannot be chained in V1.
matchView.when({ orderId: "order_456" });

const listener: SignalListener<
  "order.submitted",
  { readonly orderId: string }
> = (occurrence) => {
  expectTypeOf(occurrence).toEqualTypeOf<
    SignalOccurrence<"order.submitted", { readonly orderId: string }>
  >();
  expectTypeOf(occurrence.signalId).toEqualTypeOf<"order.submitted">();
};
void listener;

type OrderPayload = {
  status: "open" | "closed";
  labels: readonly string[];
  customer: {
    id: string;
    metadata: { active: boolean; rank: number };
  };
};

const nestedMatch: SignalMatch<OrderPayload> = {
  status: "open",
  labels: ["priority"],
  customer: { metadata: { active: true } },
};
expectTypeOf(nestedMatch).toMatchTypeOf<SignalMatch<OrderPayload>>();

const invalidKey: SignalMatch<OrderPayload> = {
  // @ts-expect-error Match objects reject fields absent from the payload.
  missing: true,
};
void invalidKey;
expectTypeOf<{ missing: true }>().not.toExtend<SignalMatch<OrderPayload>>();
type InvalidKeyRejected = ExpectFalse<
  Extends<{ missing: true }, SignalMatch<OrderPayload>>
>;
declare const invalidKeyRejected: InvalidKeyRejected;
expectTypeOf(invalidKeyRejected).toEqualTypeOf<false>();

const invalidValues: SignalMatch<OrderPayload> = {
  // @ts-expect-error Arrays are exact values with their original element type.
  labels: [1],
  customer: {
    metadata: {
      // @ts-expect-error Nested scalar values preserve their payload type.
      active: "yes",
    },
  },
};
void invalidValues;
type InvalidNestedValueRejected = ExpectFalse<
  Extends<
    { customer: { metadata: { active: "yes" } } },
    SignalMatch<OrderPayload>
  >
>;
declare const invalidNestedValueRejected: InvalidNestedValueRejected;
expectTypeOf(invalidNestedValueRejected).toEqualTypeOf<false>();

const normalizedPayloadSchema = z
  .object({ count: z.string() })
  .transform(({ count }) => ({
    count: Number(count),
    normalized: true as const,
  }));

expectTypeOf<
  [
    InferSignalSchemaInput<typeof normalizedPayloadSchema>,
    InferSignalSchemaOutput<typeof normalizedPayloadSchema>,
  ]
>().toEqualTypeOf<[{ count: string }, { count: number; normalized: true }]>();

const normalizedSignal = signal({
  id: "counter.normalized",
  schema: normalizedPayloadSchema,
});
expectTypeOf(normalizedSignal.publish({ count: "2" })).toEqualTypeOf<
  Promise<SignalPublishReceipt<"counter.normalized">>
>();
// @ts-expect-error publish accepts authored schema input, not normalized output.
normalizedSignal.publish({ count: 2, normalized: true });
normalizedSignal.subscribe((occurrence) => {
  expectTypeOf(occurrence.payload).toEqualTypeOf<{
    count: number;
    normalized: true;
  }>();
});
normalizedSignal.when((payload) => payload.count > 0 && payload.normalized);

const orderRelease = flow(
  "order release",
  { signals: { orderSubmitted } },
  async (scope) => {
    const occurrence = await scope.waitFor(orderSubmitted);
    expectTypeOf(occurrence).toEqualTypeOf<
      SignalOccurrence<"order.submitted", { orderId: string }>
    >();

    const undeclared = signal({
      id: "order.cancelled",
      schema: z.object({ orderId: z.string() }),
    });
    // @ts-expect-error Flow waits accept only static Signal sources declared by this Flow.
    await scope.waitFor(undeclared);
  },
);
void orderRelease;

const mixedSignalFlow = flow(
  "mixed signal flow",
  {
    signals: {
      approval: z.object({ approved: z.boolean() }),
      orderSubmitted,
      matchingOrder: matchView,
    },
  },
  async (scope) => {
    expectTypeOf(await scope.suspend("approval")).toEqualTypeOf<{
      approved: boolean;
    }>();
    expectTypeOf(await scope.waitFor(orderSubmitted)).toEqualTypeOf<
      SignalOccurrence<"order.submitted", { orderId: string }>
    >();
    expectTypeOf(await scope.waitFor(matchView)).toEqualTypeOf<
      SignalOccurrence<"order.submitted", { orderId: string }>
    >();
    const ordinaryEvent = await scope.waitFor<{ approvedBy: string }>(
      "release.approved",
      { match: { orderId: "order_123" } },
    );
    expectTypeOf(ordinaryEvent).toEqualTypeOf<{ approvedBy: string }>();
    // @ts-expect-error Static Signal sources are not local suspend keys.
    await scope.suspend("orderSubmitted");
  },
);

await mixedSignalFlow.signal("flow_123", "approval", { approved: true });
// @ts-expect-error Static Signal sources are not local handle.signal delivery keys.
await mixedSignalFlow.signal("flow_123", "orderSubmitted", {
  orderId: "order_123",
});
