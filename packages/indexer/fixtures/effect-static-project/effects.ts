import { effect } from "@use-crux/core/effect";

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
