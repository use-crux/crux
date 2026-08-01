import { effect, rollbackOnError } from "@use-crux/core/effect";

const execute = async (input: { id: string }) => input.id;

export const reserveInventory = effect("inventory.reserve", execute);

export const chargePayment = effect("payments.charge", execute, {
  version: 2,
  resource: (input) => ({ type: "payment", id: input.id }),
  recover: async () => undefined,
});

export const replaceCustomer = effect("crm.customer.replace", execute, {
  recover: {
    capture: async () => ({ previous: "active" }),
    execute: async () => undefined,
  },
});

declare const dynamicEffectId: string;

export const dynamicEffect = effect(dynamicEffectId, execute);

export const duplicateCharge = effect("payments.charge", execute, {
  version: 2,
  recover: async () => undefined,
});

const boundaryOptions = { recovery: "required" } as const;
declare const chooseEffect: boolean;
const dynamicEffectReference = chooseEffect ? reserveInventory : chargePayment;

void rollbackOnError(async () => {
  await reserveInventory({ id: "required" });
});

void rollbackOnError(
  async () => {
    await reserveInventory({ id: "best-effort" });
  },
  { recovery: "best-effort" },
);

void rollbackOnError(async () => {
  await chargePayment({ id: "recoverable" });
});

void rollbackOnError(
  async () => {
    await reserveInventory({ id: "spread" });
  },
  { ...boundaryOptions },
);

void rollbackOnError(async () => {
  await dynamicEffectReference({ id: "dynamic-reference" });
});
