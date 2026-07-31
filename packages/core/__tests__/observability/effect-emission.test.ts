import { afterEach, describe, expect, it } from "vitest";
import { effect, recover } from "@use-crux/core/effect";
import {
  CruxGraphRecordBatchSchema,
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxGraphRecord,
} from "../../src/observability";

describe("effect observability emission", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("emits an effect.run span and privacy-safe receipt summary", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const update = effect(
      "customer.observed-update",
      async (input: {
        readonly customerId: string;
        readonly secretToken: string;
      }) => ({
        customerId: input.customerId,
        privateResult: input.secretToken,
      }),
      {
        resource: ({ customerId }) => ({
          type: "customer",
          id: customerId,
        }),
      },
    );

    const execution = await update.run({
      customerId: "customer_1",
      secretToken: "secret-token",
    });
    await observe.flush();

    expect(CruxGraphRecordBatchSchema.safeParse({
      records: transport.records,
    }).success).toBe(true);
    const start = effectStarts(transport.records)[0];
    expect(start).toMatchObject({
      family: "effect",
      primitive: "effect.run",
      name: "customer.observed-update",
      attributes: {
        "crux.effect.id": "customer.observed-update",
        "crux.effect.version": 1,
        "crux.effect.receipt.id": execution.receipt.id,
        "crux.effect.outcome": "preparing",
        "crux.effect.recovery": "irreversible",
      },
    });
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        spanId: start?.spanId,
        kind: "effect.receipt",
        preview: {
          kind: "effect.receipt",
          receiptId: execution.receipt.id,
          effectId: "customer.observed-update",
          effectVersion: 1,
          scopeId: expect.any(String),
          boundaryId: expect.any(String),
          outcome: "succeeded",
          recovery: "irreversible",
          resource: { type: "customer", id: "customer_1" },
        },
      }),
    );
    expect(JSON.stringify(transport.records)).not.toContain("secret-token");
    expect(JSON.stringify(transport.records)).not.toContain("privateResult");
  });

  it("emits a recovery attempt linked to the original effect span", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const update = effect(
      "customer.observed-recovery",
      async (input: {
        readonly customerId: string;
        readonly recoverySecret: string;
      }) => ({ revision: input.recoverySecret.length }),
      {
        resource: ({ customerId }) => ({
          type: "customer",
          id: customerId,
        }),
        recover: async ({ input, output }) => {
          void input.recoverySecret;
          void output.revision;
        },
      },
    );

    const execution = await update.run({
      customerId: "customer_2",
      recoverySecret: "recovery-secret",
    });
    await recover(execution.receipt);
    await observe.flush();

    const starts = effectStarts(transport.records);
    expect(starts).toHaveLength(2);
    const original = starts.find(
      (record) =>
        record.attributes?.["crux.effect.receipt.id"] ===
        execution.receipt.id,
    );
    const attempt = starts.find(
      (record) =>
        record.attributes?.["crux.effect.parent_receipt.id"] ===
        execution.receipt.id,
    );
    expect(original).toBeDefined();
    expect(attempt).toBeDefined();
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "recovery.of",
        from: { kind: "span", id: attempt?.spanId },
        to: { kind: "span", id: original?.spanId },
      }),
    );
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        spanId: attempt?.spanId,
        kind: "effect.receipt",
        preview: expect.objectContaining({
          parentReceiptId: execution.receipt.id,
          outcome: "succeeded",
        }),
      }),
    );
    expect(JSON.stringify(transport.records)).not.toContain(
      "recovery-secret",
    );
  });
});

function effectStarts(
  records: readonly CruxGraphRecord[],
): readonly Extract<CruxGraphRecord, { type: "span:start" }>[] {
  return records.filter(
    (
      record,
    ): record is Extract<CruxGraphRecord, { type: "span:start" }> =>
      record.type === "span:start" &&
      record.primitive === "effect.run",
  );
}
