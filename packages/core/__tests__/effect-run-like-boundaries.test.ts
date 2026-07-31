import { describe, expect, it, vi } from "vitest";
import { config, inMemoryRecordStore } from "@use-crux/core";
import {
  createFakeAgentExecutor,
  createPipeline,
} from "@use-crux/core/agent";
import {
  CruxEffectError,
  effect,
  rollback,
  rollbackOnError,
} from "@use-crux/core/effect";
import type { EffectScopeRef } from "@use-crux/core/effect";
import { flow } from "@use-crux/core/flow";

describe("passive run-like effect boundaries", () => {
  it("retains flow-step effects for explicit rollback after completion", async () => {
    const recover = vi.fn(async () => undefined);
    const publish = effect(
      "run-like.flow-publish",
      async () => "published",
      { recover },
    );
    const publication = flow("run-like-publication", async (scope) => {
      await scope.step("publish", () => publish.run());
      return "completed";
    });

    const result = await publication.run({ flowId: "flow-passive-boundary" });

    expect(result.status).toBe("completed");
    expect(recover).not.toHaveBeenCalled();
    const rollbackResult = await rollback(result.effects);
    expect(rollbackResult.status).toBe("completed");
    expect(recover).toHaveBeenCalledOnce();
  });

  it("retains composition effects on the pipeline result", async () => {
    const recover = vi.fn(async () => undefined);
    const update = effect(
      "run-like.pipeline-update",
      async () => "updated",
      { recover },
    );
    const pipeline = createPipeline(createFakeAgentExecutor());

    const result = await pipeline({
      id: "run-like-pipeline",
      context: {},
      steps: [
        {
          name: "update",
          fn: async () => update.run(),
        },
      ],
    });

    expect(recover).not.toHaveBeenCalled();
    await rollback(result.effects);
    expect(recover).toHaveBeenCalledOnce();
    expect(result.results[0]?.effects).toEqual(result.effects);
  });

  it("does not enforce recovery or roll back a failed flow automatically", async () => {
    const recover = vi.fn(async () => undefined);
    const recoverable = effect(
      "run-like.failed-flow-recoverable",
      async () => undefined,
      { recover },
    );
    const irreversible = effect(
      "run-like.failed-flow-irreversible",
      async () => undefined,
    );
    let effects: EffectScopeRef | undefined;
    const failed = flow("run-like-failed", async (scope) => {
      effects = scope.effects;
      await irreversible.run();
      await recoverable.run();
      throw new Error("flow failed");
    });

    await expect(failed.run()).rejects.toThrow("flow failed");
    expect(recover).not.toHaveBeenCalled();
    const rollbackResult = await rollback(effects as EffectScopeRef);
    expect(rollbackResult.status).toBe("partial");
    expect(recover).toHaveBeenCalledOnce();
  });

  it("skips a nested boundary that already rolled itself back", async () => {
    const childRecover = vi.fn(async () => undefined);
    const outerRecover = vi.fn(async () => undefined);
    const child = effect(
      "run-like.nested-child",
      async () => undefined,
      { recover: childRecover },
    );
    const outer = effect(
      "run-like.nested-outer",
      async () => undefined,
      { recover: outerRecover },
    );
    const nested = flow("run-like-nested", async () => {
      await expect(
        rollbackOnError(async () => {
          await child.run();
          throw new Error("nested failure");
        }),
      ).rejects.toThrow("nested failure");
      await outer.run();
    });

    const result = await nested.run();
    expect(childRecover).toHaveBeenCalledOnce();
    const rollbackResult = await rollback(result.effects);
    expect(outerRecover).toHaveBeenCalledOnce();
    expect(childRecover).toHaveBeenCalledOnce();
    expect(rollbackResult.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "already_recovered" }),
      ]),
    );
  });

  it("lets a reviewer roll back inside a flow and makes the boundary terminal", async () => {
    const recover = vi.fn(async () => undefined);
    const publish = effect(
      "run-like.review-publish",
      async () => undefined,
      { recover },
    );
    const late = effect(
      "run-like.review-late",
      async () => undefined,
      { recover: async () => undefined },
    );
    const publication = flow("run-like-review", async (scope) => {
      await publish.run();
      const result = await scope.rollback({ reason: "Reviewer rejected" });
      await expect(late.run()).rejects.toMatchObject<CruxEffectError>({
        code: "EFFECT_SCOPE_TERMINAL",
      });
      return result.status;
    });

    const result = await publication.run();
    expect(result.status).toBe("completed");
    expect(result.output).toBe("completed");
    expect(recover).toHaveBeenCalledOnce();
  });

  it("retains one effect boundary across in-process flow resume", async () => {
    const crux = config({
      storage: { records: inMemoryRecordStore() },
    });
    const recover = vi.fn(async () => undefined);
    const publish = effect(
      "run-like.resumed-publish",
      async () => "published",
      { recover },
    );
    const publication = flow("run-like-resumed", async (scope) => {
      await scope.step("publish", () => publish.run());
      await scope.suspend("approval");
      return scope.rollback({ reason: "Reviewer rejected" });
    });

    try {
      const suspended = await publication.run({
        flowId: "flow-resumed-boundary",
      });
      expect(suspended.status).toBe("suspended");
      await publication.signal(suspended.flowId, "approval");

      const completed = await publication.resume(suspended.flowId);
      expect(completed.status).toBe("completed");
      expect(completed.effects).toEqual(suspended.effects);
      if (completed.status === "completed") {
        expect(completed.output.status).toBe("completed");
      }
      expect(recover).toHaveBeenCalledOnce();
    } finally {
      crux.dispose();
    }
  });

  it("rejects flow rollback from a nested boundary", async () => {
    const nested = flow("run-like-descendant-rollback", async (scope) => {
      await rollbackOnError(async () => {
        await expect(scope.rollback()).rejects.toMatchObject<CruxEffectError>({
          code: "EFFECT_SCOPE_TERMINAL",
        });
        await expect(
          rollback(scope.effects),
        ).rejects.toMatchObject<CruxEffectError>({
          code: "EFFECT_SCOPE_TERMINAL",
        });
      });
      return "completed";
    });

    await expect(nested.run()).resolves.toMatchObject({
      status: "completed",
      output: "completed",
    });
  });

  it("keeps a delayed-rolled-back suspended flow terminal on resume", async () => {
    const crux = config({
      storage: { records: inMemoryRecordStore() },
    });
    const recover = vi.fn(async () => undefined);
    const first = effect(
      "run-like.suspended-first",
      async () => "published",
      { recover },
    );
    const lateExecute = vi.fn(async () => "late");
    const late = effect("run-like.suspended-late", lateExecute, {
      recover: async () => undefined,
    });
    const publication = flow("run-like-terminal-resume", async (scope) => {
      await scope.step("publish", () => first.run());
      await scope.suspend("approval");
      return late.run();
    });

    try {
      const suspended = await publication.run({
        flowId: "flow-terminal-resume",
      });
      await rollback(suspended.effects);
      await publication.signal(suspended.flowId, "approval");

      await expect(publication.resume(suspended.flowId)).rejects.toMatchObject<CruxEffectError>({
        code: "EFFECT_SCOPE_TERMINAL",
      });
      expect(recover).toHaveBeenCalledOnce();
      expect(lateExecute).not.toHaveBeenCalled();
    } finally {
      crux.dispose();
    }
  });

  it("drains a concurrently resumed effect before delayed rollback plans", async () => {
    const crux = config({
      storage: { records: inMemoryRecordStore() },
    });
    const firstRecover = vi.fn(async () => undefined);
    const first = effect(
      "run-like.concurrent-first",
      async () => "published",
      { recover: firstRecover },
    );
    let announceLateStarted: () => void = () => undefined;
    const lateStarted = new Promise<void>((resolve) => {
      announceLateStarted = resolve;
    });
    let releaseLate: () => void = () => undefined;
    const lateRelease = new Promise<void>((resolve) => {
      releaseLate = resolve;
    });
    const lateRecover = vi.fn(async () => undefined);
    const late = effect(
      "run-like.concurrent-late",
      async () => {
        announceLateStarted();
        await lateRelease;
        return "late";
      },
      { recover: lateRecover },
    );
    const publication = flow("run-like-concurrent-resume", async (scope) => {
      await scope.step("publish", () => first.run());
      await scope.suspend("approval");
      return late.run();
    });

    try {
      const suspended = await publication.run({
        flowId: "flow-concurrent-resume",
      });
      await publication.signal(suspended.flowId, "approval");
      const resumed = publication.resume(suspended.flowId);
      await lateStarted;
      const rolledBack = rollback(suspended.effects);
      releaseLate();

      const [completed, rollbackResult] = await Promise.all([
        resumed,
        rolledBack,
      ]);
      expect(completed.status).toBe("completed");
      expect(rollbackResult.units).toHaveLength(2);
      expect(firstRecover).toHaveBeenCalledOnce();
      expect(lateRecover).toHaveBeenCalledOnce();
    } finally {
      crux.dispose();
    }
  });
});
