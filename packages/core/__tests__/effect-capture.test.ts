import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  effect,
  recover,
  type EffectReceiptRef,
} from "../src/effect/index";
import { resetEffectDefinitionsForTesting } from "../src/effect/define-effect";

describe("effect preparation", () => {
  beforeEach(() => {
    resetEffectDefinitionsForTesting();
  });

  it("captures pre-state before execution and supplies it to recovery", async () => {
    const events: string[] = [];
    const recovery = vi.fn(async () => {
      events.push("recover");
    });
    const update = effect(
      "customer.capture-order",
      async (input: { readonly customerId: string }) => {
        events.push("execute");
        return { revision: input.customerId.length };
      },
      {
        resource: ({ customerId }) => ({
          type: "customer",
          id: customerId,
        }),
        recover: {
          capture: async ({ input }) => {
            events.push("capture");
            return {
              customerId: input.customerId,
              revision: 3,
            };
          },
          execute: recovery,
        },
      },
    );

    const execution = await update.run({ customerId: "customer_1" });
    const result = await recover(execution.receipt);

    expect(events).toEqual(["capture", "execute", "recover"]);
    expect(recovery).toHaveBeenCalledWith({
      input: { customerId: "customer_1" },
      output: { revision: 10 },
      captured: { customerId: "customer_1", revision: 3 },
      receipt: execution.receipt,
      resource: { type: "customer", id: "customer_1" },
      idempotencyKey: expect.stringMatching(/^effect-recovery:/),
      conflict: "fail",
      signal: undefined,
    });
    expect(result.resource).toEqual({
      type: "customer",
      id: "customer_1",
    });
  });

  it("records capture failure without running the executor", async () => {
    const original = new Error("snapshot unavailable");
    const executor = vi.fn(async () => "updated");
    let receipt: EffectReceiptRef | undefined;
    const update = effect(
      "customer.capture-failure",
      executor,
      {
        recover: {
          capture: async (context) => {
            receipt = context.receipt;
            throw original;
          },
          execute: async () => undefined,
        },
      },
    );

    await expect(update.run()).rejects.toMatchObject({
      code: "EFFECT_CAPTURE_FAILED",
      cause: original,
    });
    expect(executor).not.toHaveBeenCalled();
    expect(receipt).toBeDefined();
    if (!receipt) throw new Error("capture did not receive its receipt");
    await expect(recover(receipt)).resolves.toMatchObject({
      effectIds: ["customer.capture-failure"],
      status: "unavailable",
    });
  });

  it("fails closed when resource projection throws", async () => {
    const original = new Error("resource identity unavailable");
    const capture = vi.fn(async () => ({ revision: 1 }));
    const executor = vi.fn(async () => "updated");
    const update = effect(
      "customer.resource-failure",
      executor,
      {
        resource: () => {
          throw original;
        },
        recover: {
          capture,
          execute: async () => undefined,
        },
      },
    );

    await expect(update.run()).rejects.toMatchObject({
      code: "EFFECT_RESOURCE_FAILED",
      cause: original,
    });
    expect(capture).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });

  it("retains non-durable captured state for in-process recovery", async () => {
    const captured: { self?: unknown } = {};
    captured.self = captured;
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "customer.ephemeral-capture",
      async () => "updated",
      {
        recover: {
          capture: async () => captured,
          execute: recovery,
        },
      },
    );

    const execution = await update.run();
    await expect(recover(execution.receipt)).resolves.toMatchObject({
      status: "recovered",
    });
    expect(recovery.mock.calls[0]?.[0].captured).toBe(captured);
  });
});
