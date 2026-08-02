import { describe, expect, it } from "vitest";

import {
  createMemoryStatisticsLedger,
  type StatisticsOwner,
} from "../src/statistics";

describe("statistics ledger transport retries", () => {
  it("attributes physical retry usage without adding semantic model calls", () => {
    const ledger = createMemoryStatisticsLedger();
    const owner = { kind: "run", id: "retry" } satisfies StatisticsOwner;

    ledger.record({
      owner,
      cursor: 1,
      at: new Date("2026-08-01T10:00:01.000Z"),
      fact: { kind: "model-call", outcome: "started", model: "sealed-model" },
    });
    ledger.record({
      owner,
      cursor: 2,
      at: new Date("2026-08-01T10:00:02.000Z"),
      fact: {
        kind: "transport-retry",
        model: "sealed-model",
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          totalTokens: 10,
          costUsd: 0.02,
        },
      },
    });
    ledger.record({
      owner,
      cursor: 3,
      at: new Date("2026-08-01T10:00:03.000Z"),
      fact: { kind: "transport-retry", model: "sealed-model" },
    });

    const scope = ledger.snapshot(owner)!.scope;
    expect(scope.modelCalls).toEqual({
      started: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      transportRetries: 2,
    });
    expect(scope.usage).toMatchObject({
      inputTokens: 8,
      outputTokens: 2,
      totalTokens: 10,
      costUsd: 0.02,
      coverage: { tokens: "partial", cost: "partial" },
      byModel: {
        "sealed-model": {
          calls: 1,
          inputTokens: 8,
          outputTokens: 2,
          totalTokens: 10,
          costUsd: 0.02,
          coverage: { tokens: "partial", cost: "partial" },
        },
      },
    });
  });
});
