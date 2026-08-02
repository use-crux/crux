/** Compile the public Signal guide/reference examples against shipped exports. */

import { expectTypeOf } from "vitest";
import { flow, signal } from "@use-crux/core";
import {
  InvalidSignalPayloadError,
  noPayload,
  type FlowWaitForSignalOptions,
} from "@use-crux/core/flow";
import {
  SignalError,
  SignalValidationError,
  type SignalOccurrence,
  type SignalErrorCode,
  type SignalPublishGuarantee,
} from "@use-crux/core/signal";
import { z } from "zod";

const orderSubmitted = signal({
  id: "order.submitted",
  schema: z.object({
    orderId: z.string(),
    quantity: z.coerce.number().int().positive(),
  }),
});

orderSubmitted.subscribe((occurrence) => {
  expectTypeOf(occurrence).toEqualTypeOf<
    SignalOccurrence<
      "order.submitted",
      { orderId: string; quantity: number }
    >
  >();
});

const receipt = await orderSubmitted.publish({
  orderId: "order_123",
  quantity: "2",
});
expectTypeOf(receipt.guarantee).toEqualTypeOf<SignalPublishGuarantee>();

const largeOrder = orderSubmitted.when((payload) => payload.quantity >= 10);
const thisOrder = orderSubmitted.when({ orderId: "order_123" });

const release = flow(
  "release-docs-contract",
  { signals: { largeOrder, thisOrder } },
  async (scope) => {
    const options = { timeout: "24h" } satisfies FlowWaitForSignalOptions;
    const occurrence = await scope.waitFor(thisOrder, options);
    expectTypeOf(occurrence.payload.quantity).toEqualTypeOf<number>();

    const undeclared = signal({
      id: "order.cancelled",
      schema: z.object({ orderId: z.string() }),
    });
    // @ts-expect-error Static Signal waits accept only values in this Flow map.
    await scope.waitFor(undeclared);
  },
);
void release;

const localReview = flow(
  "local-review-docs-contract",
  {
    signals: {
      approve: z.object({ reviewerId: z.string() }),
      cancel: noPayload(),
      thisOrder,
    },
  },
  async (scope) => scope.suspend("approve"),
);

await localReview.signal("flow_123", "approve", { reviewerId: "user_123" });
await localReview.signal("flow_123", "cancel", { resume: false });
// @ts-expect-error Static Signal sources publish through the Signal definition.
await localReview.signal("flow_123", "thisOrder", {
  orderId: "order_123",
  quantity: 2,
});

declare const error: unknown;
if (error instanceof SignalValidationError) {
  expectTypeOf(error.code).toEqualTypeOf<SignalErrorCode>();
  expectTypeOf(error.issues).toMatchTypeOf<readonly { message: string }[]>();
} else if (error instanceof SignalError) {
  expectTypeOf(error.code).toMatchTypeOf<
    "invalid_payload" | "idempotency_conflict" | "publication_rejected"
  >();
} else if (error instanceof InvalidSignalPayloadError) {
  expectTypeOf(error.signalName).toEqualTypeOf<string>();
}
