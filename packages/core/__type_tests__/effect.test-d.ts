/** Compile-time contract for callable custom effect definitions. */

import { expectTypeOf } from "vitest";
import { effect, recover } from "../src/effect/index";
import type {
  EffectReceiptRef,
  EffectDefinition,
  EffectExecutionContext,
  EffectExecutionResult,
  EffectScopeRef,
  RecoverableEffectDefinition,
  RecoverableEffectOptions,
  RecoveryUnitResult,
  RollbackOptions,
  RollbackResult,
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

type UpdateInput = {
  readonly customerId: string;
  readonly active: boolean;
};
type UpdateOutput = {
  readonly updated: boolean;
};

const recoverableOptions = {
  recover: async ({
    input,
    output,
  }: {
    readonly input: UpdateInput;
    readonly output: UpdateOutput;
  }) => {
    expectTypeOf(input.customerId).toEqualTypeOf<string>();
    expectTypeOf(output.updated).toEqualTypeOf<boolean>();
  },
} satisfies RecoverableEffectOptions<UpdateInput, UpdateOutput>;

const updateCustomer = effect(
  "customers.update",
  async (_input: UpdateInput): Promise<UpdateOutput> => ({
    updated: true,
  }),
  recoverableOptions,
);

expectTypeOf(updateCustomer).toMatchTypeOf<
  RecoverableEffectDefinition<UpdateInput, UpdateOutput>
>();
expectTypeOf(
  updateCustomer.recover({
    kind: "effect.receipt",
    id: "receipt_1",
    effectId: "customers.update",
  }),
).toEqualTypeOf<Promise<RecoveryUnitResult>>();

effect(
  "customers.update-captured",
  async (_input: UpdateInput): Promise<UpdateOutput> => ({
    updated: true,
  }),
  {
    recover: {
      capture: async ({ input }) => ({
        customerId: input.customerId,
        wasActive: !input.active,
      }),
      execute: async ({ captured }) => {
        expectTypeOf(captured).toEqualTypeOf<{
          customerId: string;
          wasActive: boolean;
        }>();
      },
    },
  },
);

const receiptRef: EffectReceiptRef = {
  kind: "effect.receipt",
  id: "receipt_1",
  effectId: "customers.update",
};
const scopeRef: EffectScopeRef = {
  kind: "effect.scope",
  id: "scope_1",
  runId: "run_1",
};

expectTypeOf(recover(receiptRef)).toEqualTypeOf<
  Promise<RecoveryUnitResult>
>();
// @ts-expect-error recover accepts receipt references, not scope references
recover(scopeRef);

declare const rollback: (
  scope: EffectScopeRef,
  options?: RollbackOptions,
) => Promise<RollbackResult>;
// @ts-expect-error rollback accepts scope references, not receipt references
rollback(receiptRef);
