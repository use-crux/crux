import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import effectFixture from "../../../../../../core/src/observability/fixtures/effect-v5.json";
import { EffectCard } from "./EffectCard";

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
    artifacts: effectFixture.records.filter(
      (record) => record.type === "artifact" && record.spanId === spanId,
    ),
    relations: effectFixture.records.filter(
      (record) =>
        record.type === "edge" &&
        (record.from?.id === spanId || record.to?.id === spanId),
    ),
    children: [],
  } as unknown as ObservabilityRunDetailNode;
}

function withReceiptState(
  node: ObservabilityRunDetailNode,
  outcome: "unknown",
  recovery: "ambiguous",
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

describe("EffectCard", () => {
  it("renders a preparing recovery attempt without a false failure", () => {
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
    const html = renderToStaticMarkup(<EffectCard node={node} root={node} />);

    expect(html).toContain("Preparing");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Recovery failed");
  });

  it("renders the RFC grammar and folded recovery state", () => {
    const original = effectNode("1111111111111111");
    const recovery = effectNode("2222222222222222");
    const root = {
      id: "run_effect_fixture",
      children: [original, recovery],
    } as unknown as ObservabilityRunDetailNode;

    const html = renderToStaticMarkup(
      <EffectCard node={original} root={root} />,
    );
    expect(html).toContain("Effect · crm.customer.update");
    expect(html).toContain("crm.customer · customer_1");
    expect(html).toContain("Succeeded");
    expect(html).toContain("Recovered");
    expect(html).toContain("effect_receipt_1");
  });

  it("links a recovery attempt to the original span", () => {
    const original = effectNode("1111111111111111");
    const recovery = effectNode("2222222222222222");
    const root = {
      id: "run_effect_fixture",
      children: [original, recovery],
    } as unknown as ObservabilityRunDetailNode;
    const html = renderToStaticMarkup(
      <EffectCard node={recovery} root={root} />,
    );

    expect(html).toContain("Recovery of");
    expect(html).toContain("1111111111111111");
    expect(html).toContain("Recovered");
  });

  it("renders an ambiguous outcome honestly", () => {
    const ambiguous = withReceiptState(
      effectNode("1111111111111111"),
      "unknown",
      "ambiguous",
    );
    const html = renderToStaticMarkup(
      <EffectCard node={ambiguous} root={ambiguous} />,
    );

    expect(html).toContain("Unknown");
    expect(html).toContain("Ambiguous");
  });

  it("renders every summary for a multi-resource Effect", () => {
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
    const html = renderToStaticMarkup(<EffectCard node={node} root={node} />);

    expect(html).toContain("crm.customer · customer_1");
    expect(html).toContain("crm.account · account_1");
  });
});
