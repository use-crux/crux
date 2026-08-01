import { expect, it, vi } from "vitest";
import { dispatchSealedProvider } from "../src/adapter/execution/sealed-provider-dispatch";
import { createPreparationStatistics } from "../src/request/prepare/statistics";

it("does not record a semantic call when sealed-plan validation rejects", async () => {
  const statistics = createPreparationStatistics();
  const validate = vi.fn(async () => {
    throw new Error("invalid sealed plan");
  });
  const call = vi.fn(async (_request: Readonly<Record<string, never>>) => ({}));
  const recordRetries = vi.fn();

  await expect(
    dispatchSealedProvider({
      request: {},
      model: "model-1",
      statistics,
      validate,
      call,
      settlement: () => ({}),
      recordRetries,
    }),
  ).rejects.toThrow("invalid sealed plan");

  expect(validate).toHaveBeenCalledOnce();
  expect(call).not.toHaveBeenCalled();
  expect(recordRetries).not.toHaveBeenCalled();
  expect(statistics.beforeStep({ stepIndex: 0, reason: "initial" })).toMatchObject({
    cursor: 0,
    run: {
      modelCalls: {
        started: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        transportRetries: 0,
      },
    },
  });
});

it("records one failed terminal fact when retry bookkeeping rejects", async () => {
  const statistics = createPreparationStatistics();
  const error = new Error("retry receipt rejected");

  await expect(
    dispatchSealedProvider({
      request: {},
      model: "model-1",
      statistics,
      validate: async () => undefined,
      call: async (_request: Readonly<Record<string, never>>) => ({}),
      settlement: () => ({}),
      recordRetries: () => {
        throw error;
      },
    }),
  ).rejects.toBe(error);

  expect(statistics.beforeStep({ stepIndex: 0, reason: "initial" })).toMatchObject({
    cursor: 2,
    run: {
      modelCalls: {
        started: 1,
        succeeded: 0,
        failed: 1,
        cancelled: 0,
      },
    },
  });
});
