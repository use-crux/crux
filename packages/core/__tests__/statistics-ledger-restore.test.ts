import { describe, expect, it } from "vitest";

import {
  createMemoryStatisticsLedger,
  type StatisticsLedger,
  type StatisticsLedgerExport,
  type StatisticsOwner,
} from "../src/statistics";

const owner = { kind: "run", id: "restore" } satisfies StatisticsOwner;

describe("statistics ledger restore", () => {
  it("preserves valid snapshots, replay identity, and overflow slots", () => {
    const ledger = createMemoryStatisticsLedger();
    for (let index = 0; index < 65; index += 1) {
      ledger.record({
        owner,
        cursor: index + 1,
        at: new Date(1_900_000_000_000 + index),
        fact: {
          kind: "model-call",
          outcome: "started",
          model: `model-${index}`,
        },
      });
    }
    const exported = ledger.export(owner)!;
    const restored = createMemoryStatisticsLedger();
    restored.restore(JSON.parse(JSON.stringify(exported)));

    expect(restored.snapshot(owner)).toEqual(ledger.snapshot(owner));
    restored.record({
      owner,
      cursor: 66,
      at: new Date(1_900_000_000_065),
      fact: { kind: "model-call", outcome: "started", model: "model-0" },
    });
    restored.record({
      owner,
      cursor: 67,
      at: new Date(1_900_000_000_066),
      fact: { kind: "model-call", outcome: "started", model: "new-overflow" },
    });

    const usage = restored.snapshot(owner)!.scope.usage;
    expect(usage.byModel["model-0"]?.calls).toBe(2);
    expect(usage.byModel["new-overflow"]).toBeUndefined();
    expect(usage.otherModels?.calls).toBe(2);
  });

  it("fully validates adversarial state before mutating an owner", () => {
    const source = createMemoryStatisticsLedger();
    source.record({
      owner,
      cursor: 1,
      at: new Date("2026-08-01T10:00:01.000Z"),
      fact: { kind: "model-call", outcome: "started", model: "model-a" },
    });
    source.record({
      owner,
      cursor: 2,
      at: new Date("2026-08-01T10:00:02.000Z"),
      fact: { kind: "tool", outcome: "called", name: "search" },
    });
    const valid = source.export(owner)!;

    const malformed: readonly unknown[] = [
      null,
      { ...valid, version: 2 },
      { ...valid, owner: { kind: "invalid", id: owner.id } },
      { ...valid, cursor: Number.NaN },
      { ...valid, state: "{" },
      withState(valid, (state) => {
        state.unexpected = "content";
      }),
      withState(valid, (state) => {
        state.owner = { kind: owner.kind, id: "different" };
      }),
      withState(valid, (state) => {
        state.cursor = valid.cursor + 1;
      }),
      withState(valid, (state) => {
        object(state, "usage").calls = -1;
      }),
      withState(valid, (state) => {
        object(state, "modelCalls").started = 1.5;
      }),
      withState(valid, (state) => {
        state.startedAt = "not-a-timestamp";
      }),
      withState(valid, (state) => {
        state.updatedAt = "2026-08-01T09:59:59.000Z";
      }),
      withState(valid, (state) => {
        const entry = array(state, "models")[0];
        state.models = Array.from({ length: 65 }, (_, index) => [
          `model-${index}`,
          Array.isArray(entry) ? entry[1] : {},
        ]);
      }),
      withState(valid, (state) => {
        object(object(state, "work"), "current").running = -1;
      }),
      withState(valid, (state) => {
        state.otherTools = {
          called: 0,
          succeeded: 0,
          failed: 0,
          denied: 0,
          cancelled: 0,
        };
      }),
      withState(valid, (state) => {
        object(state, "tools").called = 2;
      }),
      withState(valid, (state) => {
        state.lastRecordFingerprint = "not the accepted high-water record";
      }),
    ];

    for (const candidate of malformed) {
      const target = ledgerAtCursorOne();
      const before = target.snapshot(owner);
      expect(() => restoreUnknown(target, candidate)).toThrow(TypeError);
      expect(target.snapshot(owner)).toEqual(before);
    }
  });
});

function ledgerAtCursorOne(): StatisticsLedger {
  const ledger = createMemoryStatisticsLedger();
  ledger.record({
    owner,
    cursor: 1,
    at: new Date("2026-08-01T10:00:01.000Z"),
    fact: { kind: "model-call", outcome: "started", model: "original" },
  });
  return ledger;
}

function restoreUnknown(ledger: StatisticsLedger, value: unknown): void {
  Reflect.apply(ledger.restore, ledger, [value]);
}

function withState(
  value: StatisticsLedgerExport,
  mutate: (state: Record<string, unknown>) => void,
): unknown {
  const state: Record<string, unknown> = JSON.parse(value.state);
  mutate(state);
  return { ...value, state: JSON.stringify(state) };
}

function object(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const nested = value[key];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    throw new TypeError(`Expected ${key} to be an object.`);
  }
  return nested as Record<string, unknown>;
}

function array(value: Record<string, unknown>, key: string): unknown[] {
  const nested = value[key];
  if (!Array.isArray(nested))
    throw new TypeError(`Expected ${key} to be an array.`);
  return nested;
}
