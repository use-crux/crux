import { describe, expect, it, vi } from "vitest";
import { evidence, flow } from "../src";
import {
  EffectOutcomeUnknownError,
  effect,
  reconcileEffect,
  recover,
  type EffectReceiptRef,
} from "@use-crux/core/effect";

describe("effect evidence", () => {
  it("contributes intent and change evidence when a receipt settles", async () => {
    const update = effect(
      "customer.evidence-update",
      async (input: { readonly customerId: string }) => ({
        revision: input.customerId.length,
      }),
      {
        resource: ({ customerId }) => ({
          type: "customer",
          id: customerId,
        }),
        recover: async () => undefined,
      },
    );
    const result = await flow("effect-evidence", async (scope) =>
      scope.step("update", async () => {
        const execution = await update.run({
          customerId: "customer_sensitive_input",
        });
        const view = await evidence.inspect(execution.receipt, {
          includeData: true,
        });
        return { receipt: execution.receipt, view };
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const { receipt, view } = result.output;
    expect(view.subject).toEqual(receipt);
    expect(view.roles.intent).toMatchObject({
      status: "present",
      records: [
        {
          ref: {
            subject: receipt,
            role: "intent",
            evidenceKind: "custom.effect-receipt",
          },
          source: receipt,
          payloadState: "available",
          data: {
            effectId: "customer.evidence-update",
            effectVersion: 1,
            resource: { type: "customer", id: "customer_sensitive_input" },
          },
        },
      ],
    });
    expect(view.roles.change).toMatchObject({
      status: "present",
      conclusion: "applied",
      records: [
        {
          ref: {
            subject: receipt,
            role: "change",
            evidenceKind: "custom.effect-receipt",
          },
          source: receipt,
          conclusion: "applied",
          payloadState: "available",
          data: {
            outcome: "succeeded",
            recovery: "available",
          },
        },
      ],
    });
    expect(view.roles.authority.records).toEqual([]);
    expect(view.roles.verification.records).toEqual([]);
    for (const record of [
      ...view.roles.intent.records,
      ...view.roles.change.records,
    ]) {
      expect(record.ref.id).toMatch(/^evidence_[0-9a-f]{64}$/u);
    }
  });

  it("links recovery settlement evidence to the original receipt", async () => {
    const update = effect(
      "customer.evidence-recovery",
      async () => ({ revision: 2 }),
      { recover: async () => undefined },
    );
    const result = await flow("effect-recovery-evidence", async (scope) =>
      scope.step("recover", async () => {
        const execution = await update.run();
        await recover(execution.receipt);
        await recover(execution.receipt);
        const view = await evidence.inspect(execution.receipt, {
          includeData: true,
        });
        return { receipt: execution.receipt, view };
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const { receipt, view } = result.output;
    expect(view.roles.recovery).toMatchObject({
      status: "present",
      conclusion: "succeeded",
      records: [
        {
          ref: {
            subject: receipt,
            role: "recovery",
            evidenceKind: "custom.effect-receipt",
          },
          source: {
            kind: "effect.receipt",
            id: expect.not.stringMatching(receipt.id),
            effectId: receipt.effectId,
          },
          conclusion: "succeeded",
          payloadState: "available",
          data: {
            outcome: "succeeded",
            recovery: "recovered",
          },
        },
      ],
    });
  });

  it("never includes input, output, or captured values in evidence records", async () => {
    const inputSecret = "sensitive-input-value";
    const outputSecret = "sensitive-output-value";
    const capturedSecret = "sensitive-captured-value";
    const update = effect(
      "customer.evidence-privacy",
      async () => ({ secret: outputSecret }),
      {
        resource: () => ({ type: "customer", id: "customer_safe" }),
        recover: {
          capture: async () => ({ secret: capturedSecret }),
          execute: async () => undefined,
        },
      },
    );
    const result = await flow("effect-evidence-privacy", async (scope) =>
      scope.step("update-and-recover", async () => {
        const execution = await update.run({ secret: inputSecret });
        await recover(execution.receipt);
        const original = await evidence.inspect(execution.receipt, {
          includeData: true,
        });
        const attempt = original.roles.recovery.records[0]?.source;
        if (!attempt || attempt.kind !== "effect.receipt") {
          throw new TypeError("Recovery evidence did not link its receipt.");
        }
        return {
          original,
          attempt: await evidence.inspect(attempt, {
            includeData: true,
          }),
        };
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const serialized = JSON.stringify(result.output);
    expect(serialized).not.toContain(inputSecret);
    expect(serialized).not.toContain(outputSecret);
    expect(serialized).not.toContain(capturedSecret);
    expect(serialized).toContain("customer_safe");
    expect(
      result.output.attempt.roles.intent.records[0],
    ).toMatchObject({
      data: {
        resource: { type: "customer", id: "customer_safe" },
      },
    });
    for (const view of [result.output.original, result.output.attempt]) {
      expect(view.roles.authority.records).toEqual([]);
      expect(view.roles.verification.records).toEqual([]);
    }
  });

  it("projects failed and unknown receipt settlements honestly", async () => {
    let failedReceipt: EffectReceiptRef | undefined;
    let unknownReceipt: EffectReceiptRef | undefined;
    const fail = effect(
      "customer.evidence-failed",
      async (_input: void, context) => {
        failedReceipt = {
          kind: "effect.receipt",
          id: context.receiptId,
          effectId: "customer.evidence-failed",
        };
        throw new Error("Provider rejected the update.");
      },
    );
    const becomeUnknown = effect(
      "customer.evidence-unknown",
      async (_input: void, context) => {
        unknownReceipt = {
          kind: "effect.receipt",
          id: context.receiptId,
          effectId: "customer.evidence-unknown",
        };
        throw new EffectOutcomeUnknownError("Provider outcome unknown.");
      },
    );
    const result = await flow("effect-failure-evidence", async (scope) =>
      scope.step("settle", async () => {
        await expect(fail.run()).rejects.toThrow("Provider rejected");
        await expect(becomeUnknown.run()).rejects.toBeInstanceOf(
          EffectOutcomeUnknownError,
        );
        if (!failedReceipt || !unknownReceipt) {
          throw new TypeError("Effects did not expose their receipts.");
        }
        return {
          failed: await evidence.inspect(failedReceipt),
          unknown: await evidence.inspect(unknownReceipt),
        };
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.failed.roles.change).toMatchObject({
      conclusion: "no-change",
      records: [
        {
          conclusion: "no-change",
        },
      ],
    });
    expect(result.output.unknown.roles.change).toMatchObject({
      conclusion: "unknown",
      records: [
        {
          conclusion: "unknown",
        },
      ],
    });
    expect(
      result.output.failed.roles.change.records[0],
    ).not.toHaveProperty("data");
    expect(
      result.output.unknown.roles.change.records[0],
    ).not.toHaveProperty("data");
  });

  it("does not let evidence projection alter effect execution", async () => {
    const resource = Object.defineProperty({}, "type", {
      get() {
        throw new Error("Evidence projection failed.");
      },
    }) as { readonly type: string };
    const update = effect(
      "customer.evidence-isolation",
      async () => "updated",
      { resource: () => resource },
    );

    const result = await flow("effect-evidence-isolation", async (scope) =>
      scope.step("update", () => update()),
    ).run();

    expect(result).toMatchObject({
      status: "completed",
      output: "updated",
    });
  });

  it("supersedes unknown change evidence after reconciliation", async () => {
    let receipt: EffectReceiptRef | undefined;
    const update = effect(
      "customer.evidence-reconcile",
      async (_input: void, context) => {
        receipt = {
          kind: "effect.receipt",
          id: context.receiptId,
          effectId: "customer.evidence-reconcile",
        };
        throw new EffectOutcomeUnknownError("Provider outcome unknown.");
      },
    );
    const result = await flow("effect-evidence-reconcile", async (scope) =>
      scope.step("reconcile", async () => {
        await expect(update()).rejects.toBeInstanceOf(
          EffectOutcomeUnknownError,
        );
        if (!receipt) throw new TypeError("Effect receipt was not exposed.");
        await reconcileEffect(receipt, {
          outcome: "succeeded",
          output: null,
          reason: "Provider confirmed the update.",
        });
        return evidence.inspect(receipt, {
          includeData: true,
          includeHistory: true,
        });
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.roles.change).toMatchObject({
      conclusion: "applied",
      conflicting: false,
      records: [{ conclusion: "applied", data: { outcome: "succeeded" } }],
      history: [{ conclusion: "unknown", data: { outcome: "unknown" } }],
    });
  });

  it("supersedes ambiguous recovery evidence after reconciliation", async () => {
    const update = effect(
      "customer.evidence-recovery-reconcile",
      async () => "updated",
      {
        recover: async () => {
          throw new EffectOutcomeUnknownError(
            "Recovery outcome unknown.",
          );
        },
      },
    );
    const result = await flow(
      "effect-recovery-evidence-reconcile",
      async (scope) =>
        scope.step("reconcile", async () => {
          const execution = await update.run();
          await recover(execution.receipt);
          await reconcileEffect(execution.receipt, {
            outcome: "succeeded",
            output: null,
            reason: "Provider confirmed recovery.",
          });
          const original = await evidence.inspect(execution.receipt, {
            includeHistory: true,
          });
          const attempt = original.roles.recovery.records[0]?.source;
          if (!attempt || attempt.kind !== "effect.receipt") {
            throw new TypeError("Recovery evidence did not link its receipt.");
          }
          return {
            original,
            attempt: await evidence.inspect(attempt, {
              includeHistory: true,
            }),
          };
        }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.original.roles.recovery).toMatchObject({
      conclusion: "succeeded",
      conflicting: false,
      records: [{ conclusion: "succeeded" }],
      history: [{ conclusion: "partial" }],
    });
    expect(result.output.attempt.roles.change).toMatchObject({
      conclusion: "applied",
      conflicting: false,
      records: [{ conclusion: "applied" }],
      history: [{ conclusion: "unknown" }],
    });
  });

  it("supersedes failed recovery evidence after a successful retry", async () => {
    const recovery = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Recovery failed."))
      .mockResolvedValueOnce();
    const update = effect(
      "customer.evidence-recovery-retry",
      async () => "updated",
      { recover: recovery },
    );
    const result = await flow("effect-recovery-evidence-retry", async (scope) =>
      scope.step("retry", async () => {
        const execution = await update.run();
        await recover(execution.receipt);
        await recover(execution.receipt);
        return evidence.inspect(execution.receipt, {
          includeHistory: true,
        });
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.roles.recovery).toMatchObject({
      conclusion: "succeeded",
      conflicting: false,
      records: [{ conclusion: "succeeded" }],
      history: [{ conclusion: "failed" }],
    });
    expect(recovery).toHaveBeenCalledTimes(2);
  });
});
