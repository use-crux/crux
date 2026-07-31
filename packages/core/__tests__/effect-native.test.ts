import { afterEach, describe, expect, it, vi } from "vitest";
import { evidence, flow } from "../src";
import {
  EffectOutcomeUnknownError,
  reconcileEffect,
  recover,
  rollback,
} from "@use-crux/core/effect";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxGraphRecord,
} from "../src/observability";
import { effectLedger } from "../src/effect/internal/ledger";
import {
  runNativeEffect,
  type NativeEffectProvider,
} from "../src/effect/internal/native";

interface FakeSourceMutation {
  readonly sourceId: string;
  readonly privateRevision: string;
  readonly recovery: "unavailable" | "irreversible";
}

describe("native effect contract", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("records audit-first native receipts on their owning span", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const prepareRecovery = vi.fn(async () => ({ revision: "private-old" }));
    const executeRecovery = vi.fn(async () => undefined);
    const provider: NativeEffectProvider<
      FakeSourceMutation,
      { readonly revision: string }
    > = {
      describe(operation) {
        return {
          effectId: "corpus.source.upsert",
          effectVersion: 1,
          nativePrimitive: "corpus.sync",
          recovery: operation.recovery,
          resource: {
            type: "corpus.source",
            id: operation.sourceId,
          },
        };
      },
      prepareRecovery,
      recover: executeRecovery,
    };

    const run = await flow("native-effect-fake", async (scope) =>
      scope.step("mutate", async () => {
        const mutate = async (operation: FakeSourceMutation) => {
          const span = observe.openSpan({
            name: `fake-corpus-source-upsert-${operation.recovery}`,
            primitive: "corpus.sync",
            attributes: { sourceCount: 1 },
          });
          try {
            const execution = await runNativeEffect(
              provider,
              operation,
              span,
              async () => ({ changed: true as const }),
            );
            const view = await evidence.inspect(execution.receipt, {
              includeData: true,
            });
            const individual = await recover(execution.receipt, {
              reason: "Verify audit-first capability reporting",
            });
            span.end({ status: "ok" });
            return { execution, view, individual };
          } catch (error) {
            span.error(error);
            throw error;
          }
        };
        const unknownSpan = observe.openSpan({
          name: "fake-corpus-source-upsert-unknown",
          primitive: "corpus.sync",
        });
        try {
          await runNativeEffect(
            provider,
            {
              sourceId: "source_3",
              privateRevision: "private-unknown",
              recovery: "unavailable",
            },
            unknownSpan,
            async () => {
              throw new EffectOutcomeUnknownError("Fake provider timed out.");
            },
          );
        } catch (error) {
          unknownSpan.error(error);
        }
        const unknownReceipt = effectLedger
          .receiptsFor(scope.effects.id)
          .find((receipt) => receipt.outcome === "unknown");
        if (!unknownReceipt) {
          throw new TypeError("The fake native receipt was not recorded.");
        }
        const unknownRef = {
          kind: "effect.receipt",
          id: unknownReceipt.id,
          effectId: unknownReceipt.effectId,
        } as const;
        const reconciled = await reconcileEffect(unknownRef, {
          outcome: "succeeded",
          output: { confirmed: true },
          reason: "The fake provider confirmed the mutation.",
        });
        const reconciledRecovery = await recover(unknownRef);
        return {
          unavailable: await mutate({
            sourceId: "source_1",
            privateRevision: "private-new",
            recovery: "unavailable",
          }),
          irreversible: await mutate({
            sourceId: "source_2",
            privateRevision: "private-second",
            recovery: "irreversible",
          }),
          unknown: {
            before: unknownReceipt,
            reconciled,
            individual: reconciledRecovery,
          },
        };
      }),
    ).run();

    expect(run.status).toBe("completed");
    if (run.status !== "completed") return;
    const unavailableReceipt = effectLedger.getReceipt(
      run.output.unavailable.execution.receipt.id,
    );
    const irreversibleReceipt = effectLedger.getReceipt(
      run.output.irreversible.execution.receipt.id,
    );
    for (const [result, receipt, status, sourceId] of [
      [run.output.unavailable, unavailableReceipt, "unavailable", "source_1"],
      [run.output.irreversible, irreversibleReceipt, "irreversible", "source_2"],
    ] as const) {
      expect(receipt).toMatchObject({
        kind: "effect.receipt",
        effectId: "corpus.source.upsert",
        effectVersion: 1,
        effectKind: "native",
        nativePrimitive: "corpus.sync",
        outcome: "succeeded",
        recovery: status,
        resource: { type: "corpus.source", id: sourceId },
      });
      expect(effectLedger.getEnvelope(result.execution.receipt.id)).toBeUndefined();
      expect(result.execution.output).toEqual({ changed: true });
      expect(result.individual).toMatchObject({
        effectIds: ["corpus.source.upsert"],
        status,
      });
    }
    expect(run.output.unavailable.view.roles.intent).toMatchObject({
      status: "present",
      records: [
        {
          ref: {
            subject: run.output.unavailable.execution.receipt,
            role: "intent",
          },
          data: {
            effectId: "corpus.source.upsert",
            effectVersion: 1,
            resource: { type: "corpus.source", id: "source_1" },
          },
        },
      ],
    });
    expect(run.output.irreversible.view.roles.change).toMatchObject({
      status: "present",
      conclusion: "applied",
      records: [
        {
          data: { outcome: "succeeded", recovery: "irreversible" },
        },
      ],
    });
    expect(run.output.unknown.before).toMatchObject({
      outcome: "unknown",
      recovery: "unavailable",
    });
    expect(run.output.unknown.reconciled).toMatchObject({
      outcome: "succeeded",
      recovery: "unavailable",
    });
    expect(run.output.unknown.individual).toMatchObject({
      effectIds: ["corpus.source.upsert"],
      status: "unavailable",
    });

    const rollbackResult = await rollback(run.effects, {
      reason: "Verify audit-first rollback reporting",
    });
    expect(rollbackResult).toMatchObject({
      status: "not_possible",
      units: [
        {
          effectIds: ["corpus.source.upsert"],
          status: "irreversible",
        },
        {
          effectIds: ["corpus.source.upsert"],
          status: "unavailable",
        },
        {
          effectIds: ["corpus.source.upsert"],
          status: "unavailable",
        },
      ],
    });
    expect(prepareRecovery).not.toHaveBeenCalled();
    expect(executeRecovery).not.toHaveBeenCalled();

    await observe.flush();
    expect(effectStarts(transport.records)).toEqual([]);
    for (const [result, receipt, status] of [
      [run.output.unavailable, unavailableReceipt, "unavailable"],
      [run.output.irreversible, irreversibleReceipt, "irreversible"],
    ] as const) {
      const nativeStart = transport.records.find(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "corpus.sync" &&
          record.name === `fake-corpus-source-upsert-${status}`,
      );
      expect(nativeStart).toBeDefined();
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: "span:end",
          spanId: nativeStart?.spanId,
          attributes: expect.objectContaining({
            "crux.effect.id": "corpus.source.upsert",
            "crux.effect.version": 1,
            "crux.effect.receipt.id": result.execution.receipt.id,
            "crux.effect.scope.id": receipt?.scopeId,
            "crux.effect.boundary.id": run.effects.id,
            "crux.effect.outcome": "succeeded",
            "crux.effect.recovery": status,
          }),
        }),
      );
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: "artifact",
          spanId: nativeStart?.spanId,
          kind: "effect.receipt",
          preview: expect.objectContaining({
            receiptId: result.execution.receipt.id,
            effectId: "corpus.source.upsert",
            outcome: "succeeded",
            recovery: status,
          }),
        }),
      );
    }
    const serialized = JSON.stringify(transport.records);
    expect(serialized).not.toContain("private-new");
    expect(serialized).not.toContain("private-second");
    expect(serialized).not.toContain("private-unknown");
    expect(serialized).not.toContain("private-old");
    expect(serialized).not.toContain("nativeRef");
  });
});

function effectStarts(
  records: readonly CruxGraphRecord[],
): readonly Extract<CruxGraphRecord, { type: "span:start" }>[] {
  return records.filter(
    (record): record is Extract<CruxGraphRecord, { type: "span:start" }> =>
      record.type === "span:start" && record.primitive === "effect.run",
  );
}
