import { afterEach, describe, expect, it } from "vitest";
import {
  config,
  effect,
  evidence,
  EffectOutcomeUnknownError,
  reconcileEffect,
  recover,
} from "../src";
import { resetEffectDefinitionsForTesting } from "../src/effect/define-effect";
import { resetEffectLedgerForTesting } from "../src/effect/internal/ledger";
import { inMemoryRuntimeStore } from "../src/runtime/adapters/memory";
import { createRuntimeProgram, node } from "../src/runtime/public";
import { resetHooks } from "../src/runtime/runtime";

afterEach(() => {
  resetEffectDefinitionsForTesting();
  resetEffectLedgerForTesting();
  resetHooks();
});

describe("durable Effect evidence read model", () => {
  it("resolves a persisted receipt subject after process-local state is lost", async () => {
    const store = inMemoryRuntimeStore();
    let receiptId = "";
    let ambiguousReceiptId = "";
    const update = effect(
      "customer.restart-evidence",
      async (_input: undefined, context) => {
        receiptId = context.receiptId;
        return "updated";
      },
      {
        resource: () => ({ type: "customer", id: "customer-1" }),
        recover: async () => {
          throw new EffectOutcomeUnknownError("recovery outcome unknown");
        },
      },
    );
    const ambiguous = effect(
      "customer.restart-reconciliation",
      async (_input: undefined, context) => {
        ambiguousReceiptId = context.receiptId;
        throw new EffectOutcomeUnknownError("provider outcome unknown");
      },
    );
    const runtime = config({
      runtime: node({
        namespace: "tenant-a",
        store,
        program: createRuntimeProgram({
          targets: [],
          transports: [],
          effectTargets: [update],
        }),
        autoStartMaintenance: false,
      }),
    });

    try {
      const execution = await update.run();
      await recover(execution.receipt);
      await reconcileEffect(execution.receipt, {
        outcome: "succeeded",
        output: null,
        reason: "provider confirmed recovery",
      });
      await expect(ambiguous()).rejects.toBeInstanceOf(
        EffectOutcomeUnknownError,
      );
      await reconcileEffect(
        {
          kind: "effect.receipt",
          id: ambiguousReceiptId,
          effectId: "customer.restart-reconciliation",
        },
        {
          outcome: "succeeded",
          output: null,
          reason: "provider confirmed the change",
        },
      );
      resetEffectLedgerForTesting();
      const subject = {
        kind: "effect.receipt" as const,
        id: receiptId,
        effectId: "customer.restart-evidence",
      };

      const view = await evidence.inspect(subject, {
        includeData: true,
        includeHistory: true,
      });

      expect(view).toMatchObject({
        source: "destination",
        subject,
        roles: {
          intent: {
            status: "present",
            records: [
              {
                data: {
                  effectId: "customer.restart-evidence",
                  effectVersion: 1,
                  resource: { type: "customer", id: "customer-1" },
                },
              },
            ],
          },
          change: {
            status: "present",
            conclusion: "applied",
            records: [{ data: { outcome: "succeeded" } }],
          },
          recovery: {
            status: "present",
            conclusion: "succeeded",
            records: [
              {
                source: {
                  kind: "effect.receipt",
                  id: expect.not.stringMatching(receiptId),
                  effectId: "customer.restart-evidence",
                },
                data: { outcome: "succeeded", recovery: "recovered" },
              },
            ],
            history: [
              {
                conclusion: "partial",
                data: { outcome: "unknown", recovery: "ambiguous" },
              },
            ],
          },
        },
      });
      const reconciled = await evidence.inspect(
        {
          kind: "effect.receipt",
          id: ambiguousReceiptId,
          effectId: "customer.restart-reconciliation",
        },
        { includeData: true, includeHistory: true },
      );
      expect(reconciled.roles.change).toMatchObject({
        status: "present",
        conclusion: "applied",
        conflicting: false,
        records: [{ conclusion: "applied" }],
        history: [{ conclusion: "unknown" }],
      });
    } finally {
      runtime.dispose();
    }
  });
});
