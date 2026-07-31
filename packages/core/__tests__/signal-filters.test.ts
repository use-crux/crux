import { describe, expect, it } from "vitest";
import { z } from "zod";
import { signal } from "@use-crux/core";

describe("Signal filter views", () => {
  it("creates frozen inert predicate and match identities", () => {
    const changed = signal({
      id: "account.changed",
      schema: z.object({ account: z.object({ id: z.string() }) }),
    });
    const predicate = (payload: { account: { id: string } }) =>
      payload.account.id === "account_123";
    const authoredMatch = { account: { id: "account_123" } };

    const predicateView = changed.when(predicate);
    const matchView = changed.when(authoredMatch);
    authoredMatch.account.id = "mutated";

    expect(predicateView).toEqual({
      _tag: "FilteredSignal",
      filterKind: "predicate",
      signal: changed,
      predicate,
    });
    expect(matchView.match).toEqual({ account: { id: "account_123" } });
    expect(Object.isFrozen(predicateView)).toBe(true);
    expect(Object.isFrozen(matchView)).toBe(true);
    expect(Object.isFrozen(matchView.match.account)).toBe(true);
    expect("publish" in matchView).toBe(false);
    expect("subscribe" in matchView).toBe(false);
    expect("when" in matchView).toBe(false);
  });

  it("canonicalizes nested match objects while preserving array order", () => {
    const changed = signal({
      id: "workflow.changed",
      schema: z.object({
        metadata: z.object({ alpha: z.number(), zeta: z.number() }),
        steps: z.array(
          z.object({ alpha: z.number(), id: z.string(), zeta: z.number() }),
        ),
      }),
    });
    const first = changed.when({
      steps: [
        { zeta: 2, id: "first", alpha: 1 },
        { zeta: 4, id: "second", alpha: 3 },
      ],
      metadata: { zeta: 6, alpha: 5 },
    });
    const second = changed.when({
      metadata: { alpha: 5, zeta: 6 },
      steps: [
        { alpha: 1, id: "first", zeta: 2 },
        { alpha: 3, id: "second", zeta: 4 },
      ],
    });

    expect(JSON.stringify(first.match)).toBe(JSON.stringify(second.match));
    expect(Object.keys(first.match)).toEqual(["metadata", "steps"]);
    expect(Object.keys(first.match.metadata!)).toEqual(["alpha", "zeta"]);
    expect(first.match.steps?.map((step) => step.id)).toEqual([
      "first",
      "second",
    ]);
    expect(Object.keys(first.match.steps![0]!)).toEqual([
      "alpha",
      "id",
      "zeta",
    ]);
  });

  it("retains an own __proto__ match key as immutable canonical data", () => {
    const changed = signal({
      id: "prototype.changed",
      schema: z.record(z.string(), z.object({ identity: z.string() })),
    });
    const authoredMatch: Record<string, { identity: string }> = {};
    Object.defineProperty(authoredMatch, "__proto__", {
      value: { identity: "prototype-match" },
      enumerable: true,
      writable: true,
      configurable: true,
    });

    const view = changed.when(authoredMatch);
    authoredMatch.__proto__!.identity = "mutated";

    expect(Object.hasOwn(view.match, "__proto__")).toBe(true);
    expect(Object.keys(view.match)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(view.match, "__proto__")).toMatchObject({
      value: { identity: "prototype-match" },
      enumerable: true,
    });
    expect(Object.getPrototypeOf(view.match)).toBe(Object.prototype);
    expect(Object.isFrozen(view.match.__proto__)).toBe(true);
    expect(JSON.stringify(view.match)).toBe(
      '{"__proto__":{"identity":"prototype-match"}}',
    );
  });
});
