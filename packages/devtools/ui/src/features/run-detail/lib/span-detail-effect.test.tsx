import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import effectFixture from "../../../../../../core/src/observability/fixtures/effect-v5.json";
import { effectRollup, projectEffectRun } from "./span-detail-effect";

function effectNode(spanId: string): ObservabilityRunDetailNode {
  const start = effectFixture.records.find(
    (record) => record.type === "span:start" && record.spanId === spanId,
  );
  const end = effectFixture.records.find(
    (record) => record.type === "span:end" && record.spanId === spanId,
  );
  if (!start || start.type !== "span:start") {
    throw new Error(`Missing effect fixture span ${spanId}`);
  }
  const artifacts = effectFixture.records.filter(
    (record) => record.type === "artifact" && record.spanId === spanId,
  );
  const relations = effectFixture.records.filter(
    (record) =>
      record.type === "edge" &&
      (record.from?.id === spanId || record.to?.id === spanId),
  );
  return {
    id: spanId,
    spanId,
    primitive: start.primitive,
    name: start.name,
    status: end?.type === "span:end" ? end.status : start.status,
    attributes: {
      ...start.attributes,
      ...(end?.type === "span:end" ? end.attributes : {}),
    },
    artifacts: artifacts as unknown as ObservabilityRunDetailNode["artifacts"],
    relations: relations as unknown as ObservabilityRunDetailNode["relations"],
    children: [],
  } as unknown as ObservabilityRunDetailNode;
}

function withReceiptState(
  node: ObservabilityRunDetailNode,
  outcome: "succeeded" | "failed" | "cancelled" | "unknown",
  recovery: "available" | "unavailable" | "ambiguous" | "recovered",
): ObservabilityRunDetailNode {
  return {
    ...node,
    attributes: {
      ...node.attributes,
      "crux.effect.outcome": outcome,
      "crux.effect.recovery": recovery,
    },
    artifacts: node.artifacts.map((artifact) => ({
      ...artifact,
      preview:
        artifact.kind === "effect.receipt" &&
        typeof artifact.preview === "object" &&
        artifact.preview !== null
          ? { ...artifact.preview, outcome, recovery }
          : artifact.preview,
    })),
  };
}

describe("projectEffectRun", () => {
  it("projects a start-only Effect while it is preparing", () => {
    const settled = effectNode("2222222222222222");
    const node = {
      ...settled,
      attributes: {
        ...settled.attributes,
        "crux.effect.outcome": "preparing",
        "crux.effect.recovery": "unavailable",
      },
      artifacts: [],
    } as ObservabilityRunDetailNode;

    expect(projectEffectRun(node, node)).toMatchObject({
      outcome: "preparing",
      recoveryState: "unavailable",
      recoveryOfSpanId: "1111111111111111",
    });
  });

  it("falls back field-by-field when a receipt preview is malformed", () => {
    const original = effectNode("1111111111111111");
    const node = {
      ...original,
      artifacts: original.artifacts.map((artifact) => ({
        ...artifact,
        preview:
          artifact.kind === "effect.receipt" &&
          typeof artifact.preview === "object" &&
          artifact.preview !== null
            ? {
                ...artifact.preview,
                effectId: 1,
                effectVersion: 0,
                receiptId: false,
                outcome: "preparing",
                recovery: "invalid",
              }
            : artifact.preview,
      })),
    } as ObservabilityRunDetailNode;

    expect(projectEffectRun(node, node)).toMatchObject({
      effectId: "crm.customer.update",
      effectVersion: 1,
      receiptId: "effect_receipt_1",
      outcome: "succeeded",
      recoveryState: "recoverable",
    });
  });

  it("projects the execution receipt into the safe Effect card contract", () => {
    const node = effectNode("1111111111111111");

    expect(projectEffectRun(node, node)).toEqual({
      effectId: "crm.customer.update",
      effectVersion: 1,
      receiptId: "effect_receipt_1",
      outcome: "succeeded",
      recoveryState: "recoverable",
      resource: {
        type: "crm.customer",
        id: "customer_1",
        attributes: {
          region: "eu",
          priority: 2,
          active: true,
        },
      },
    });
  });

  it("projects a recovery attempt with its original-span linkage", () => {
    const original = effectNode("1111111111111111");
    const recovery = effectNode("2222222222222222");
    const root = {
      id: "run_effect_fixture",
      children: [original, recovery],
    } as unknown as ObservabilityRunDetailNode;

    expect(projectEffectRun(recovery, root)).toEqual({
      effectId: "crm.customer.update",
      effectVersion: 1,
      receiptId: "effect_receipt_2",
      outcome: "succeeded",
      recoveryState: "recovered",
      recoveryOfSpanId: "1111111111111111",
      resource: {
        type: "crm.customer",
        id: "customer_1",
      },
    });
  });

  it("folds the linked recovery outcome onto the original Effect", () => {
    const original = effectNode("1111111111111111");
    const recovery = effectNode("2222222222222222");
    const root = {
      id: "run_effect_fixture",
      children: [original, recovery],
    } as unknown as ObservabilityRunDetailNode;

    expect(projectEffectRun(original, root)?.recoveryState).toBe("recovered");
  });

  it("folds the latest linked recovery attempt after a retry", () => {
    const recovered = effectNode("2222222222222222");
    const recoveryRelation = recovered.relations[0]!;
    const failed = withReceiptState(
      ({
        ...recovered,
        id: "span_failed_recovery",
        spanId: "span_failed_recovery",
        relations: [
          {
            ...recoveryRelation,
            edgeId: "edge_failed_recovery",
            from: { kind: "span", id: "span_failed_recovery" },
            createdAt: "2026-07-31T12:00:02.500Z",
          },
        ],
      } as unknown as ObservabilityRunDetailNode),
      "failed",
      "unavailable",
    );
    const original = {
      ...effectNode("1111111111111111"),
      relations: [...failed.relations, recoveryRelation],
    } as ObservabilityRunDetailNode;
    const root = {
      id: "run_effect_fixture",
      children: [original, failed, recovered],
    } as unknown as ObservabilityRunDetailNode;

    expect(projectEffectRun(original, root)?.recoveryState).toBe("recovered");
  });

  it("projects every summary for a multi-resource Effect", () => {
    const original = effectNode("1111111111111111");
    const node = {
      ...original,
      artifacts: original.artifacts.map((artifact) => ({
        ...artifact,
        preview:
          artifact.kind === "effect.receipt" &&
          typeof artifact.preview === "object" &&
          artifact.preview !== null
            ? {
                ...artifact.preview,
                resource: [
                  { type: "crm.customer", id: "customer_1" },
                  { type: "crm.account", id: "account_1" },
                ],
              }
            : artifact.preview,
      })),
    } as ObservabilityRunDetailNode;

    expect(projectEffectRun(node, node)?.resource).toEqual([
      { type: "crm.customer", id: "customer_1" },
      { type: "crm.account", id: "account_1" },
    ]);
  });

  it("projects an ambiguous outcome honestly", () => {
    const ambiguous = withReceiptState(
      effectNode("1111111111111111"),
      "unknown",
      "ambiguous",
    );

    expect(projectEffectRun(ambiguous, ambiguous)?.recoveryState).toBe(
      "ambiguous",
    );
  });

  it("rolls original Effects up without double-counting recovery attempts", () => {
    const original = effectNode("1111111111111111");
    const recovery = effectNode("2222222222222222");
    const ambiguous = withReceiptState(
      ({
        ...effectNode("1111111111111111"),
        id: "3333333333333333",
        spanId: "3333333333333333",
        relations: [],
      } as unknown as ObservabilityRunDetailNode),
      "unknown",
      "ambiguous",
    );
    const root = {
      id: "run_effect_fixture",
      children: [original, recovery, ambiguous],
    } as unknown as ObservabilityRunDetailNode;

    expect(effectRollup(root)).toEqual({
      effects: 2,
      recoverable: 0,
      ambiguous: 1,
      label: "2 effects · 0 recoverable · 1 ambiguous",
    });
  });
});
