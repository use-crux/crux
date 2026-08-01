import { afterEach, describe, expect, it } from "vitest";
import {
  config,
  flow,
  InvalidSignalPayloadError,
  noPayload,
  signalFlow,
} from "@use-crux/core";
import {
  effect,
  rollback,
  type EffectScopeRef,
} from "@use-crux/core/effect";
import {
  inMemoryRecordStore,
  type JsonObject,
  type RecordStore,
} from "@use-crux/core/storage";
import { resetHooks } from "../src/runtime/runtime";

afterEach(() => {
  resetHooks();
});

describe("RecordStore Flow Effects", () => {
  it("replaces an unresolvable Effect ref on completion", async () => {
    const records = inMemoryRecordStore();
    const crux = config({ storage: { records } });
    const review = flow("rotate stale completion Effects", async (scope) => {
      await scope.suspend("approval");
      return scope.effects;
    });

    try {
      const suspended = await review.run({
        flowId: "flow_stale_completion_effects",
      });
      await seedStaleEffects(records, suspended.flowId, "missing-completion");
      await review.signal(suspended.flowId, "approval");

      const completed = await review.resume(suspended.flowId);
      expect(completed.effects.id).not.toBe("missing-completion");
      await expect(records.get(flowKey(suspended.flowId))).resolves.toMatchObject({
        status: "completed",
        effects: completed.effects,
      });
    } finally {
      crux.dispose();
    }
  });

  it("replaces an unresolvable Effect ref on expiration", async () => {
    const records = inMemoryRecordStore();
    const crux = config({ storage: { records } });
    const review = flow("rotate stale expiration Effects", async (scope) => {
      await scope.suspend("approval", { timeout: "1h" });
    });

    try {
      const suspended = await review.run({
        flowId: "flow_stale_expiration_effects",
      });
      await seedStaleEffects(records, suspended.flowId, "missing-expiration", {
        timeoutAt: Date.now() - 1,
      });

      const expired = await review.resume(suspended.flowId);
      expect(expired.effects.id).not.toBe("missing-expiration");
      await expect(records.get(flowKey(suspended.flowId))).resolves.toMatchObject({
        status: "expired",
        effects: expired.effects,
      });
    } finally {
      crux.dispose();
    }
  });

  it("replaces an unresolvable Effect ref after invalid Signal delivery", async () => {
    const records = inMemoryRecordStore();
    const crux = config({ storage: { records } });
    const observedScopes: EffectScopeRef[] = [];
    const release = flow(
      "rotate stale invalid Signal Effects",
      { signals: { release: noPayload() } },
      async (scope) => {
        observedScopes.push(scope.effects);
        await scope.suspend("release");
        return "released";
      },
    );

    try {
      const suspended = await release.run({
        flowId: "flow_stale_invalid_signal_effects",
      });
      await seedStaleEffects(records, suspended.flowId, "missing-invalid");
      await signalFlow(suspended.flowId, "release", { unexpected: true });

      await expect(release.resume(suspended.flowId)).rejects.toBeInstanceOf(
        InvalidSignalPayloadError,
      );
      const retryScope = observedScopes[1];
      expect(retryScope).toBeDefined();
      await expect(records.get(flowKey(suspended.flowId))).resolves.toMatchObject({
        status: "suspended",
        effects: retryScope,
      });

      await signalFlow(suspended.flowId, "release", {});
      await expect(release.resume(suspended.flowId)).resolves.toMatchObject({
        status: "completed",
        effects: retryScope,
      });
      expect(observedScopes).toEqual([
        suspended.effects,
        retryScope,
        retryScope,
      ]);
    } finally {
      crux.dispose();
    }
  });

  it("retains new Effects after a failed resume", async () => {
    const records = inMemoryRecordStore();
    const crux = config({ storage: { records } });
    const observedScopes: EffectScopeRef[] = [];
    let shouldFail = true;
    let recoveries = 0;
    const recordChange = effect(
      "flow.record-store-retry.record-change",
      async () => "recorded",
      { recover: async () => void (recoveries += 1) },
    );
    const review = flow("rotate stale failed resume Effects", async (scope) => {
      observedScopes.push(scope.effects);
      await scope.suspend("approval");
      await scope.step("record change", () => recordChange());
      if (shouldFail) {
        shouldFail = false;
        throw new Error("retry RecordStore resume");
      }
      return "completed";
    });

    try {
      const suspended = await review.run({
        flowId: "flow_stale_failed_resume_effects",
      });
      await seedStaleEffects(records, suspended.flowId, "missing-retry");
      await review.signal(suspended.flowId, "approval");

      await expect(review.resume(suspended.flowId)).rejects.toThrow(
        "retry RecordStore resume",
      );
      const retryScope = observedScopes[1];
      expect(retryScope).toBeDefined();
      await expect(records.get(flowKey(suspended.flowId))).resolves.toMatchObject({
        status: "suspended",
        effects: retryScope,
      });

      const completed = await review.resume(suspended.flowId);
      expect(completed).toMatchObject({ status: "completed", effects: retryScope });
      await expect(rollback(completed.effects)).resolves.toMatchObject({
        status: "completed",
        scope: retryScope,
        units: [{ status: "recovered" }],
      });
      expect(observedScopes).toEqual([
        suspended.effects,
        retryScope,
        retryScope,
      ]);
      expect(recoveries).toBe(1);
    } finally {
      crux.dispose();
    }
  });
});

function flowKey(flowId: string): string {
  return `crux:flow:${flowId}`;
}

async function seedStaleEffects(
  records: RecordStore,
  flowId: string,
  effectId: string,
  extra: JsonObject = {},
): Promise<void> {
  const key = flowKey(flowId);
  const snapshot = await records.get(key);
  expect(snapshot).not.toBeNull();
  await records.put(key, {
    ...snapshot!,
    effects: { kind: "effect.scope", id: effectId, runId: flowId },
    ...extra,
  });
}
