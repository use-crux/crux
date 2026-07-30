/** Compile-time contract for callable custom effect definitions. */

import { expectTypeOf } from "vitest";
import { effect } from "../src/effect/index";
import type {
  EffectDefinition,
  EffectExecutionContext,
  EffectExecutionResult,
} from "../src/effect/index";

const lookupCustomer = effect(
  "customers.lookup",
  async (input: { readonly customerId: string }) => ({
    customerId: input.customerId,
    active: true,
  }),
);

expectTypeOf(lookupCustomer).toMatchTypeOf<
  EffectDefinition<
    { readonly customerId: string },
    { customerId: string; active: boolean }
  >
>();
expectTypeOf(
  lookupCustomer({ customerId: "customer_1" }),
).toEqualTypeOf<Promise<{ customerId: string; active: boolean }>>();
expectTypeOf(
  lookupCustomer.run({ customerId: "customer_1" }),
).toEqualTypeOf<
  Promise<
    EffectExecutionResult<{ customerId: string; active: boolean }>
  >
>();

const heartbeat = effect("system.heartbeat", async () => "ok" as const);
expectTypeOf(heartbeat()).toEqualTypeOf<Promise<"ok">>();
expectTypeOf(heartbeat._tag).toEqualTypeOf<"EffectDefinition">();

effect(
  "customers.activate",
  async (input: { readonly customerId: string }) => input.customerId,
);

effect(
  "customers.archive",
  async (
    input: { readonly customerId: string },
    context,
  ) => {
    expectTypeOf(context).toEqualTypeOf<EffectExecutionContext>();
    expectTypeOf(context.idempotencyKey).toEqualTypeOf<string>();
    expectTypeOf(context.receiptId).toEqualTypeOf<string>();
    expectTypeOf(context.scope.kind).toEqualTypeOf<"effect.scope">();
    return input.customerId;
  },
);
