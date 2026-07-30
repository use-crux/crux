import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  effect,
  recover,
  type EffectExecutionContext,
  type EffectRecoveryContext,
} from "../src/effect/index";
import { resetEffectDefinitionsForTesting } from "../src/effect/define-effect";

describe("effect recovery", () => {
  beforeEach(() => {
    resetEffectDefinitionsForTesting();
  });

  it("recovers one receipt with its retained execution context", async () => {
    type Input = { readonly customerId: string };
    type Output = { readonly revision: number };
    let executionContext: EffectExecutionContext | undefined;
    const recovery = vi.fn(
      async (_context: EffectRecoveryContext<Input, Output>) => undefined,
    );
    const update = effect(
      "customer.recovery-context",
      async (input: Input, context) => {
        executionContext = context;
        return { revision: input.customerId.length };
      },
      {
        resource: ({ customerId }) => ({
          type: "customer",
          id: customerId,
        }),
        recover: recovery,
      },
    );

    const execution = await update.run({ customerId: "customer_1" });
    const result = await recover(execution.receipt);

    expect(result).toEqual({
      unitId: expect.stringMatching(/^effect-unit:/),
      effectIds: ["customer.recovery-context"],
      resource: { type: "customer", id: "customer_1" },
      status: "recovered",
    });
    expect(recovery).toHaveBeenCalledWith({
      input: { customerId: "customer_1" },
      output: { revision: 10 },
      receipt: execution.receipt,
      resource: { type: "customer", id: "customer_1" },
      idempotencyKey: expect.stringMatching(/^effect-recovery:/),
      conflict: "fail",
      signal: undefined,
    });
    expect(recovery.mock.calls[0]?.[0].idempotencyKey).not.toBe(
      executionContext?.idempotencyKey,
    );
  });

  it("returns already_recovered without invoking the handler twice", async () => {
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "customer.recovery-idempotent",
      async () => "updated",
      { recover: recovery },
    );
    const execution = await update.run();

    await expect(update.recover(execution.receipt)).resolves.toMatchObject({
      status: "recovered",
    });
    await expect(recover(execution.receipt)).resolves.toMatchObject({
      status: "already_recovered",
    });
    expect(recovery).toHaveBeenCalledOnce();
  });

  it("rejects a receipt owned by another definition", async () => {
    const firstRecovery = vi.fn(async () => undefined);
    const secondRecovery = vi.fn(async () => undefined);
    const first = effect(
      "customer.recovery-first",
      async () => "first",
      { recover: firstRecovery },
    );
    const second = effect(
      "customer.recovery-second",
      async () => "second",
      { recover: secondRecovery },
    );
    const execution = await first.run();

    await expect(
      second.recover(execution.receipt),
    ).rejects.toMatchObject({
      code: "EFFECT_RECEIPT_NOT_FOUND",
    });
    expect(firstRecovery).not.toHaveBeenCalled();
    expect(secondRecovery).not.toHaveBeenCalled();
  });

  it("rejects unknown receipt and scope references before recovery", async () => {
    const recovery = vi.fn(async () => undefined);
    effect(
      "customer.recovery-validation",
      async () => "updated",
      { recover: recovery },
    );

    await expect(
      recover({
        kind: "effect.receipt",
        id: "missing-receipt",
        effectId: "customer.recovery-validation",
      }),
    ).rejects.toMatchObject({
      code: "EFFECT_RECEIPT_NOT_FOUND",
    });
    await expect(
      recover({
        kind: "effect.scope",
        id: "missing-scope",
        runId: "missing-run",
      } as unknown as Parameters<typeof recover>[0]),
    ).rejects.toMatchObject({
      code: "EFFECT_SCOPE_NOT_FOUND",
    });
    expect(recovery).not.toHaveBeenCalled();
  });
});
