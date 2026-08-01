import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CruxEffectError,
  effect,
  rollback,
  rollbackOnError,
} from "../src/effect/index";
import type {
  EffectScopeRef,
  RollbackOnErrorOptions,
} from "../src/effect/index";
import { resetEffectDefinitionsForTesting } from "../src/effect/define-effect";

async function completedBoundary(
  operations: readonly (() => Promise<unknown>)[],
  options?: RollbackOnErrorOptions,
): Promise<EffectScopeRef> {
  let ref: EffectScopeRef | undefined;
  await rollbackOnError(
    async (scope) => {
      ref = scope.ref;
      for (const operation of operations) await operation();
    },
    options,
  );
  if (!ref) throw new TypeError("Effect boundary did not run.");
  return ref;
}

describe("rollback", () => {
  beforeEach(() => {
    resetEffectDefinitionsForTesting();
  });

  it("recovers a normally completed boundary by scope reference", async () => {
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "customer.delayed-rollback",
      async () => "updated",
      { recover: recovery },
    );
    const boundaryRef = await completedBoundary([update]);
    const roundTripped: unknown = JSON.parse(
      JSON.stringify(boundaryRef),
    );
    const result = await rollback(roundTripped as EffectScopeRef);

    expect(result).toMatchObject({
      scope: boundaryRef,
      status: "completed",
      units: [
        {
          effectIds: ["customer.delayed-rollback"],
          status: "recovered",
        },
      ],
    });
    expect(recovery).toHaveBeenCalledOnce();
  });

  it("rejects an unknown scope reference before recovery", async () => {
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "customer.unknown-scope",
      async () => undefined,
      { recover: recovery },
    );
    const boundaryRef = await completedBoundary([update]);

    await expect(
      rollback({
        ...boundaryRef,
        runId: "unknown-run",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CruxEffectError>>({
        code: "EFFECT_SCOPE_NOT_FOUND",
      }),
    );
    expect(recovery).not.toHaveBeenCalled();
  });

  it("rejects a malformed scope reference before ledger lookup", async () => {
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "customer.invalid-scope-ref",
      async () => undefined,
      { recover: recovery },
    );
    const boundaryRef = await completedBoundary([update]);
    const malformed: unknown = {
      ...boundaryRef,
      kind: "effect.receipt",
    };

    await expect(
      rollback(malformed as EffectScopeRef),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CruxEffectError>>({
        code: "EFFECT_SCOPE_NOT_FOUND",
      }),
    );
    expect(recovery).not.toHaveBeenCalled();
  });

  it("cancels unsettled units when the signal aborts mid-plan", async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const first = effect(
      "customer.cancel-first",
      async () => undefined,
      {
        recover: async () => {
          events.push("recover:first");
        },
      },
    );
    const second = effect(
      "customer.cancel-second",
      async () => undefined,
      {
        recover: async () => {
          events.push("recover:second");
        },
      },
    );
    const third = effect(
      "customer.cancel-third",
      async () => undefined,
      {
        recover: async () => {
          events.push("recover:third");
          controller.abort();
        },
      },
    );
    const boundaryRef = await completedBoundary([
      first,
      second,
      third,
    ]);

    const result = await rollback(
      boundaryRef,
      { signal: controller.signal },
    );

    expect(result).toMatchObject({
      status: "cancelled",
      units: [
        {
          effectIds: ["customer.cancel-third"],
          status: "recovered",
        },
        {
          effectIds: ["customer.cancel-second"],
          status: "cancelled",
        },
        {
          effectIds: ["customer.cancel-first"],
          status: "cancelled",
        },
      ],
    });
    expect(events).toEqual(["recover:third"]);
  });

  it.each([
    {
      name: "all recovered",
      unitStatuses: ["recovered", "recovered"] as const,
      expected: "completed",
    },
    {
      name: "recovered plus blocked",
      unitStatuses: ["recovered", "irreversible"] as const,
      expected: "partial",
    },
    {
      name: "failed plus blocked",
      unitStatuses: ["failed", "irreversible"] as const,
      expected: "failed",
    },
    {
      name: "all blocked",
      unitStatuses: ["irreversible", "irreversible"] as const,
      expected: "not_possible",
    },
  ])(
    "aggregates $name units as $expected",
    async ({ name, unitStatuses, expected }) => {
      const operations: Array<() => Promise<void>> = [];
      for (const [index, status] of unitStatuses.entries()) {
        const id = `customer.aggregate-${name}-${index}`;
        if (status === "irreversible") {
          operations.push(effect(id, async () => undefined));
          continue;
        }
        operations.push(
          effect(id, async () => undefined, {
            recover: async () => {
              if (status === "failed") {
                throw new Error(`recovery failed for ${id}`);
              }
            },
          }),
        );
      }
      const boundaryRef = await completedBoundary(
        operations,
        { recovery: "best-effort" },
      );
      const result = await rollback(boundaryRef);

      expect(result.status).toBe(expected);
      expect(result.units.map((unit) => unit.status)).toEqual(
        [...unitStatuses].reverse(),
      );
    },
  );

  it("joins concurrent rollback requests for the same unit", async () => {
    let release: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recovery = vi.fn(async () => {
      await released;
    });
    const update = effect(
      "customer.concurrent-rollback",
      async () => undefined,
      { recover: recovery },
    );
    const boundaryRef = await completedBoundary([update]);

    const requests = [rollback(boundaryRef), rollback(boundaryRef)];
    release?.();
    const results = await Promise.all(requests);

    expect(recovery).toHaveBeenCalledOnce();
    expect(results.map((result) => result.status)).toEqual([
      "completed",
      "completed",
    ]);
  });

  it("retries failed units without repeating successful siblings", async () => {
    const stableRecovery = vi.fn(async () => undefined);
    const retryKeys: string[] = [];
    const flakyRecovery = vi.fn(async (context) => {
      retryKeys.push(context.idempotencyKey);
      if (retryKeys.length === 1) {
        throw new Error("temporary recovery failure");
      }
    });
    const stable = effect(
      "customer.repeat-stable",
      async () => undefined,
      { recover: stableRecovery },
    );
    const flaky = effect(
      "customer.repeat-flaky",
      async () => undefined,
      { recover: flakyRecovery },
    );
    const boundaryRef = await completedBoundary([stable, flaky]);

    const first = await rollback(boundaryRef);
    const second = await rollback(boundaryRef);
    const controller = new AbortController();
    controller.abort();
    const third = await rollback(boundaryRef, {
      signal: controller.signal,
    });

    expect(first.status).toBe("partial");
    expect(first.units.map((unit) => unit.status)).toEqual([
      "failed",
      "recovered",
    ]);
    expect(second.status).toBe("completed");
    expect(second.units.map((unit) => unit.status)).toEqual([
      "recovered",
      "already_recovered",
    ]);
    expect(third.status).toBe("completed");
    expect(third.units.map((unit) => unit.status)).toEqual([
      "already_recovered",
      "already_recovered",
    ]);
    expect(flakyRecovery).toHaveBeenCalledTimes(2);
    expect(stableRecovery).toHaveBeenCalledOnce();
    expect(retryKeys[0]).toBe(retryKeys[1]);
  });
});
