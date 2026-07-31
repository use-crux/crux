import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import { archetypeStrip } from "./archetype";

describe("archetypeStrip Effects rollup", () => {
  it("adds one compact Effects line to the existing run stats", () => {
    const effect = {
      id: "span_effect",
      spanId: "span_effect",
      primitive: "effect.run",
      attributes: {
        "crux.effect.id": "payments.charge",
        "crux.effect.version": 2,
        "crux.effect.receipt.id": "receipt_1",
        "crux.effect.outcome": "succeeded",
        "crux.effect.recovery": "available",
      },
      artifacts: [],
      relations: [],
      children: [],
    } as unknown as ObservabilityRunDetailNode;
    const root = {
      id: "run_effects",
      children: [effect],
    } as unknown as ObservabilityRunDetailNode;

    expect(
      archetypeStrip("generic", { durationMs: 10, spanCount: 2 }, root),
    ).toContainEqual({
      label: "effects",
      value: "1 effect · 1 recoverable · 0 ambiguous",
      tone: "plum",
    });
  });
});
