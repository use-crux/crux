import { describe, expect, it, vi } from "vitest";
import {
  EffectOutcomeUnknownError,
  effect,
  reconcileEffect,
  recover,
  rollback,
  rollbackOnError,
  type EffectReceiptRef,
  type EffectScopeRef,
} from "@use-crux/core/effect";

describe("effect reconciliation", () => {
  it("reports an unknown execution as ambiguous without recovering it", async () => {
    let receipt: EffectReceiptRef | undefined;
    let scope: EffectScopeRef | undefined;
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "customer.ambiguous-execution",
      async (_input: void, context) => {
        receipt = {
          kind: "effect.receipt",
          id: context.receiptId,
          effectId: "customer.ambiguous-execution",
        };
        throw new EffectOutcomeUnknownError(
          "Provider timed out after accepting the request.",
        );
      },
      { recover: recovery },
    );

    await rollbackOnError(async (boundary) => {
      scope = boundary.ref;
      await expect(update()).rejects.toBeInstanceOf(
        EffectOutcomeUnknownError,
      );
    });
    if (!receipt || !scope) {
      throw new TypeError("Effect execution did not expose its references.");
    }

    await expect(recover(receipt)).resolves.toMatchObject({
      status: "ambiguous",
    });
    await expect(rollback(scope)).resolves.toMatchObject({
      status: "not_possible",
      units: [
        {
          effectIds: ["customer.ambiguous-execution"],
          status: "ambiguous",
        },
      ],
    });
    expect(recovery).not.toHaveBeenCalled();
  });

  it("activates recovery after an unknown execution is confirmed", async () => {
    type Output = { readonly revision: number };
    let receipt: EffectReceiptRef | undefined;
    let scope: EffectScopeRef | undefined;
    const recovery = vi.fn(
      async ({ output }: { readonly output: Output }) => output,
    );
    const update = effect(
      "customer.reconciled-execution",
      async (_input: void, context): Promise<Output> => {
        receipt = {
          kind: "effect.receipt",
          id: context.receiptId,
          effectId: "customer.reconciled-execution",
        };
        throw new EffectOutcomeUnknownError("Provider result unknown.");
      },
      { recover: recovery },
    );

    await rollbackOnError(async (boundary) => {
      scope = boundary.ref;
      await expect(update()).rejects.toBeInstanceOf(
        EffectOutcomeUnknownError,
      );
    });
    if (!receipt || !scope) {
      throw new TypeError("Effect execution did not expose its references.");
    }

    await expect(
      reconcileEffect(receipt, {
        outcome: "succeeded",
        output: { revision: 2 },
        reason: "Provider confirmed revision 2.",
      }),
    ).resolves.toMatchObject({
      id: receipt.id,
      outcome: "succeeded",
      recovery: "available",
    });
    await expect(rollback(scope)).resolves.toMatchObject({
      status: "completed",
      units: [
        {
          effectIds: ["customer.reconciled-execution"],
          status: "recovered",
        },
      ],
    });
    expect(recovery).toHaveBeenCalledWith(
      expect.objectContaining({ output: { revision: 2 } }),
    );
  });

  it("settles a confirmed failed execution without a recovery unit", async () => {
    let receipt: EffectReceiptRef | undefined;
    let scope: EffectScopeRef | undefined;
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "customer.reconciled-failure",
      async (_input: void, context) => {
        receipt = {
          kind: "effect.receipt",
          id: context.receiptId,
          effectId: "customer.reconciled-failure",
        };
        throw new EffectOutcomeUnknownError("Provider result unknown.");
      },
      { recover: recovery },
    );

    await rollbackOnError(async (boundary) => {
      scope = boundary.ref;
      await expect(update()).rejects.toBeInstanceOf(
        EffectOutcomeUnknownError,
      );
    });
    if (!receipt || !scope) {
      throw new TypeError("Effect execution did not expose its references.");
    }

    await expect(
      reconcileEffect(receipt, {
        outcome: "failed",
        reason: "Provider confirmed no change was made.",
      }),
    ).resolves.toMatchObject({
      id: receipt.id,
      outcome: "failed",
      recovery: "unavailable",
    });
    await expect(recover(receipt)).resolves.toMatchObject({
      status: "unavailable",
    });
    await expect(rollback(scope)).resolves.toMatchObject({
      status: "completed",
      units: [],
    });
    expect(recovery).not.toHaveBeenCalled();
  });

  it("rejects reconciliation for settled or mismatched receipts", async () => {
    const update = effect(
      "customer.reconciliation-validation",
      async () => ({ revision: 1 }),
    );
    const execution = await update.run();
    const resolution = {
      outcome: "succeeded" as const,
      output: { revision: 1 },
      reason: "Provider confirmation.",
    };

    await expect(
      reconcileEffect(execution.receipt, resolution),
    ).rejects.toMatchObject({ code: "EFFECT_OUTCOME_AMBIGUOUS" });
    await expect(
      reconcileEffect(
        {
          ...execution.receipt,
          effectId: "customer.wrong-definition",
        },
        resolution,
      ),
    ).rejects.toMatchObject({ code: "EFFECT_OUTCOME_AMBIGUOUS" });
    let ambiguousReceipt: EffectReceiptRef | undefined;
    const ambiguous = effect(
      "customer.reconciliation-version",
      async (_input: void, context) => {
        ambiguousReceipt = {
          kind: "effect.receipt",
          id: context.receiptId,
          effectId: "customer.reconciliation-version",
        };
        throw new EffectOutcomeUnknownError("Provider result unknown.");
      },
    );
    await expect(ambiguous()).rejects.toBeInstanceOf(
      EffectOutcomeUnknownError,
    );
    if (!ambiguousReceipt) {
      throw new TypeError("Effect execution did not expose its receipt.");
    }
    await expect(
      reconcileEffect(
        {
          ...ambiguousReceipt,
          effectVersion: 2,
        } as EffectReceiptRef,
        resolution,
      ),
    ).rejects.toMatchObject({ code: "EFFECT_OUTCOME_AMBIGUOUS" });
  });

  it("does not retry an unknown recovery and reconciles it as succeeded", async () => {
    const recovery = vi.fn(async () => {
      throw new EffectOutcomeUnknownError(
        "Provider recovery result unknown.",
      );
    });
    const update = effect(
      "customer.ambiguous-recovery-success",
      async () => ({ revision: 2 }),
      { recover: recovery },
    );
    const execution = await update.run();

    await expect(recover(execution.receipt)).resolves.toMatchObject({
      status: "ambiguous",
    });
    await expect(recover(execution.receipt)).resolves.toMatchObject({
      status: "ambiguous",
    });
    expect(recovery).toHaveBeenCalledOnce();

    await expect(
      reconcileEffect(execution.receipt, {
        outcome: "succeeded",
        output: null,
        reason: "Provider confirmed recovery completed.",
      }),
    ).resolves.toMatchObject({
      id: execution.receipt.id,
      outcome: "succeeded",
      recovery: "recovered",
    });
    await expect(recover(execution.receipt)).resolves.toMatchObject({
      status: "already_recovered",
    });
    expect(recovery).toHaveBeenCalledOnce();
  });

  it("makes a confirmed failed recovery attempt retryable", async () => {
    const recovery = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(
        new EffectOutcomeUnknownError(
          "Provider recovery result unknown.",
        ),
      )
      .mockResolvedValueOnce();
    const update = effect(
      "customer.ambiguous-recovery-failure",
      async () => ({ revision: 2 }),
      { recover: recovery },
    );
    const execution = await update.run();

    await expect(recover(execution.receipt)).resolves.toMatchObject({
      status: "ambiguous",
    });
    await expect(
      reconcileEffect(execution.receipt, {
        outcome: "failed",
        reason: "Provider confirmed recovery did not run.",
      }),
    ).resolves.toMatchObject({
      id: execution.receipt.id,
      outcome: "succeeded",
      recovery: "available",
    });
    await expect(recover(execution.receipt)).resolves.toMatchObject({
      status: "recovered",
    });
    expect(recovery).toHaveBeenCalledTimes(2);
  });
});
