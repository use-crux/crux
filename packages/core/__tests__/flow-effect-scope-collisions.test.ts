import { afterEach, describe, expect, it, vi } from "vitest";
import { config, flow } from "@use-crux/core";
import {
  effect,
  rollback,
  type EffectScopeRef,
} from "@use-crux/core/effect";
import {
  inMemoryRecordStore,
  type RecordStore,
} from "@use-crux/core/storage";
import { resetHooks } from "../src/runtime/runtime";

afterEach(() => {
  vi.restoreAllMocks();
  resetHooks();
});

describe("persisted Flow Effect scope identity", () => {
  it("rotates a stale legacy ID equal to the next counter allocation", async () => {
    const records = inMemoryRecordStore();
    const crux = config({ storage: { records } });
    const review = flow("rotate colliding legacy Effects", async (scope) => {
      await scope.suspend("approval");
      return scope.effects;
    });

    try {
      const suspended = await review.run({
        flowId: "flow_stale_next_effects",
      });
      const staleId = nextCollidingBoundaryId(suspended.effects.id);
      await seedEffects(records, suspended.flowId, {
        id: staleId,
        runId: suspended.flowId,
      });
      await review.signal(suspended.flowId, "approval");

      const completed = await review.resume(suspended.flowId);
      expect(completed.status).toBe("completed");
      expect([completed.effects.id, completed.effects.runId]).not.toEqual([
        staleId,
        suspended.flowId,
      ]);
      expect(completed.effects.runId).toBe(suspended.flowId);
      await expect(records.get(flowKey(suspended.flowId))).resolves.toMatchObject({
        status: "completed",
        effects: completed.effects,
      });
    } finally {
      crux.dispose();
    }
  });

  it("isolates a resumed Flow from another Flow's live Effect scope", async () => {
    const records = inMemoryRecordStore();
    const crux = config({ storage: { records } });
    const liveReady = gate();
    const releaseLive = gate();
    let liveScope: EffectScopeRef | undefined;
    let liveRecoveries = 0;
    let resumedRecoveries = 0;
    const recordLiveChange = effect(
      "flow.scope-collision.live-change",
      async () => "live",
      { recover: async () => void (liveRecoveries += 1) },
    );
    const recordResumedChange = effect(
      "flow.scope-collision.resumed-change",
      async () => "resumed",
      { recover: async () => void (resumedRecoveries += 1) },
    );
    const resumed = flow("resume isolated Effects", async (scope) => {
      await scope.suspend("approval");
      await recordResumedChange();
      return scope.effects;
    });
    const live = flow("hold live Effects", async (scope) => {
      liveScope = scope.effects;
      await recordLiveChange();
      liveReady.open();
      await releaseLive.promise;
      return "live completed";
    });

    try {
      const suspended = await resumed.run({
        flowId: "flow_scope_collision_resumed",
      });
      const liveRun = live.run({ flowId: "flow_scope_collision_live" });
      await liveReady.promise;
      if (!liveScope) throw new Error("Live Flow did not expose its Effect scope.");
      const expectedLiveScope = liveScope;

      try {
        await seedEffects(records, suspended.flowId, {
          id: expectedLiveScope.id,
          runId: suspended.flowId,
        });
        await resumed.signal(suspended.flowId, "approval");

        const completed = await resumed.resume(suspended.flowId);
        expect(completed.status).toBe("completed");
        expect.soft([completed.effects.id, completed.effects.runId]).not.toEqual([
          expectedLiveScope.id,
          expectedLiveScope.runId,
        ]);
        expect.soft(completed.effects.runId).toBe(suspended.flowId);
        expect.soft(completed.effects).not.toBe(expectedLiveScope);

        await rollback(completed.effects);
        expect(resumedRecoveries).toBe(1);
        expect.soft(liveRecoveries).toBe(0);

        releaseLive.open();
        const liveResult = await liveRun;
        expect(liveResult.effects).toBe(expectedLiveScope);
        await rollback(liveResult.effects);
        expect(liveRecoveries).toBe(1);
        expect(resumedRecoveries).toBe(1);
      } finally {
        releaseLive.open();
        await liveRun;
      }
    } finally {
      crux.dispose();
    }
  });

  it("reuses the exact live ref object for a matching persisted tuple", async () => {
    const records = inMemoryRecordStore();
    const crux = config({ storage: { records } });
    const observedScopes: EffectScopeRef[] = [];
    const review = flow("reuse matching persisted Effects", async (scope) => {
      observedScopes.push(scope.effects);
      await scope.suspend("approval");
      return scope.effects;
    });

    try {
      const suspended = await review.run({
        flowId: "flow_matching_effect_scope",
      });
      expect(observedScopes[0]).toBe(suspended.effects);
      await review.signal(suspended.flowId, "approval");

      const completed = await review.resume(suspended.flowId);
      expect(observedScopes[1]).toBe(suspended.effects);
      expect(completed.effects).toBe(suspended.effects);
      if (completed.status === "completed") {
        expect(completed.output).toBe(suspended.effects);
      }
    } finally {
      crux.dispose();
    }
  });
});

function gate(): { readonly promise: Promise<void>; open(): void } {
  let release = (): void => {
    throw new Error("Gate was opened before initialization.");
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, open: () => release() };
}

function nextCollidingBoundaryId(currentId: string): string {
  const legacyMatch = /^effect-boundary:(\d+)$/.exec(currentId);
  if (legacyMatch) {
    return `effect-boundary:${Number(legacyMatch[1]) + 1}`;
  }

  const currentMatch = /^effect-boundary:[^:]+:([0-9a-z]+)$/.exec(currentId);
  const currentSequence = currentMatch?.[1];
  if (!currentSequence) throw new Error("Unexpected Effect boundary ID.");
  const nextSequence = (Number.parseInt(currentSequence, 36) + 1).toString(36);
  const collisionEntropy = "00000000-0000-4000-8000-000000000001";
  vi.spyOn(globalThis.crypto, "randomUUID")
    .mockReturnValueOnce(collisionEntropy)
    .mockReturnValue("00000000-0000-4000-8000-000000000002");
  return `effect-boundary:${collisionEntropy}:${nextSequence}`;
}

function flowKey(flowId: string): string {
  return `crux:flow:${flowId}`;
}

async function seedEffects(
  records: RecordStore,
  flowId: string,
  ref: { readonly id: string; readonly runId: string },
): Promise<void> {
  const key = flowKey(flowId);
  const snapshot = await records.get(key);
  expect(snapshot).not.toBeNull();
  await records.put(key, {
    ...snapshot!,
    effects: { kind: "effect.scope", ...ref },
  });
}
