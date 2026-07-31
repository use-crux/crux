import { beforeEach, describe, expect, it } from "vitest";
import {
  effect,
  rollbackOnError,
} from "../src/effect/index";
import { resetEffectDefinitionsForTesting } from "../src/effect/define-effect";

describe("effect recovery ordering", () => {
  beforeEach(() => {
    resetEffectDefinitionsForTesting();
  });

  it("rolls back a failed child relative to entry and skips it during outer rollback", async () => {
    const events: string[] = [];
    const recoverable = (id: string) =>
      effect(
        `ordering.${id}`,
        async () => {
          events.push(`execute:${id}`);
        },
        {
          recover: async () => {
            events.push(`recover:${id}`);
          },
        },
      );
    const outerBefore = recoverable("outer-before");
    const childFirst = recoverable("child-first");
    const childSecond = recoverable("child-second");
    const outerAfter = recoverable("outer-after");
    const childFailure = new Error("child failed");
    const result = await rollbackOnError(async (scope) => {
      await outerBefore();
      await expect(
        rollbackOnError(async () => {
          await childFirst();
          await childSecond();
          throw childFailure;
        }),
      ).rejects.toBe(childFailure);
      await outerAfter();
      return scope.rollback();
    });

    expect(events).toEqual([
      "execute:outer-before",
      "execute:child-first",
      "execute:child-second",
      "recover:child-second",
      "recover:child-first",
      "execute:outer-after",
      "recover:outer-after",
      "recover:outer-before",
    ]);
    expect(result.units).toMatchObject([
      {
        effectIds: ["ordering.outer-after"],
        status: "recovered",
      },
      {
        effectIds: [
          "ordering.child-first",
          "ordering.child-second",
        ],
        status: "already_recovered",
      },
      {
        effectIds: ["ordering.outer-before"],
        status: "recovered",
      },
    ]);
  });

  it("traverses a completed child boundary as one parent unit", async () => {
    const events: string[] = [];
    const recoverable = (id: string) =>
      effect(
        `ordering.completed-${id}`,
        async () => {
          events.push(`execute:${id}`);
        },
        {
          recover: async () => {
            events.push(`recover:${id}`);
          },
        },
      );
    const outerFirst = recoverable("outer-first");
    const childFirst = recoverable("child-first");
    const childSecond = recoverable("child-second");
    const outerLast = recoverable("outer-last");

    const result = await rollbackOnError(async (scope) => {
      await outerFirst();
      await rollbackOnError(async () => {
        await childFirst();
        await childSecond();
      });
      await outerLast();
      return scope.rollback();
    });

    expect(events).toEqual([
      "execute:outer-first",
      "execute:child-first",
      "execute:child-second",
      "execute:outer-last",
      "recover:outer-last",
      "recover:child-second",
      "recover:child-first",
      "recover:outer-first",
    ]);
    expect(result.units).toMatchObject([
      {
        effectIds: ["ordering.completed-outer-last"],
        status: "recovered",
      },
      {
        effectIds: [
          "ordering.completed-child-first",
          "ordering.completed-child-second",
        ],
        status: "recovered",
      },
      {
        effectIds: ["ordering.completed-outer-first"],
        status: "recovered",
      },
    ]);
  });

  it("recovers a parent effect's direct state before its nested effects", async () => {
    const events: string[] = [];
    const childFirst = effect(
      "ordering.nested-effect-child-first",
      async () => {
        events.push("execute:child-first");
      },
      {
        recover: async () => {
          events.push("recover:child-first");
        },
      },
    );
    const childSecond = effect(
      "ordering.nested-effect-child-second",
      async () => {
        events.push("execute:child-second");
      },
      {
        recover: async () => {
          events.push("recover:child-second");
        },
      },
    );
    const parent = effect(
      "ordering.nested-effect-parent",
      async () => {
        await childFirst();
        await childSecond();
        events.push("execute:parent");
      },
      {
        recover: async () => {
          events.push("recover:parent");
        },
      },
    );

    await rollbackOnError(async (scope) => {
      await parent();
      await scope.rollback();
    });

    expect(events).toEqual([
      "execute:child-first",
      "execute:child-second",
      "execute:parent",
      "recover:parent",
      "recover:child-second",
      "recover:child-first",
    ]);
  });

  it("assigns stable distinct identities and reverses repeated occurrences", async () => {
    const executionKeys: string[] = [];
    const recoveryKeys: string[] = [];
    const recoveredOutputs: number[] = [];
    const update = effect(
      "ordering.repeated-occurrence",
      async (value: number, context) => {
        executionKeys.push(context.idempotencyKey);
        return value;
      },
      {
        recover: async (context) => {
          recoveryKeys.push(context.idempotencyKey);
          recoveredOutputs.push(context.output);
        },
      },
    );

    const result = await rollbackOnError(async (scope) => {
      const first = await update.run(1);
      const second = await update.run(2);
      expect(first.receipt.id).not.toBe(second.receipt.id);
      return scope.rollback();
    });

    expect(executionKeys).toHaveLength(2);
    expect(new Set(executionKeys).size).toBe(2);
    expect(recoveryKeys).toHaveLength(2);
    expect(new Set(recoveryKeys).size).toBe(2);
    expect(recoveryKeys).not.toEqual(executionKeys);
    expect(recoveredOutputs).toEqual([2, 1]);
    expect(result.units.map((unit) => unit.status)).toEqual([
      "recovered",
      "recovered",
    ]);
  });

});
