import { describe, expect, it } from "vitest";
import {
  sessionSubscriptionMatchKey,
  sessionSubscriptionMatchValue,
} from "../../src/session/subscription-match";

describe("Session subscription match identity", () => {
  it("treats key-order variants as one canonical key", () => {
    const left = sessionSubscriptionMatchKey({
      env: "prod",
      repo: "crux",
    });
    const right = sessionSubscriptionMatchKey({
      repo: "crux",
      env: "prod",
    });
    expect(left).toBe(right);
    expect(left.length).toBeGreaterThan(0);
  });

  it("emits top-level keys in sorted order", () => {
    const value = sessionSubscriptionMatchValue({
      z: 1,
      a: 2,
      m: 3,
    });
    expect(value).toEqual({ a: 2, m: 3, z: 1 });
    expect(Object.keys(value as object)).toEqual(["a", "m", "z"]);
  });

  it("emits nested keys in sorted order and equates reordered raw inputs", () => {
    const leftRaw = {
      b: 1,
      a: { y: true, x: false, nested: { q: 1, p: 2 } },
    };
    const rightRaw = {
      a: { nested: { p: 2, q: 1 }, x: false, y: true },
      b: 1,
    };
    const left = sessionSubscriptionMatchValue(leftRaw);
    const right = sessionSubscriptionMatchValue(rightRaw);
    expect(left).toEqual({
      a: { nested: { p: 2, q: 1 }, x: false, y: true },
      b: 1,
    });
    expect(right).toEqual(left);
    expect(Object.keys(left as object)).toEqual(["a", "b"]);
    expect(Object.keys((left as { a: object }).a)).toEqual([
      "nested",
      "x",
      "y",
    ]);
    expect(
      Object.keys((left as { a: { nested: object } }).a.nested),
    ).toEqual(["p", "q"]);
    expect(sessionSubscriptionMatchKey(leftRaw)).toBe(
      sessionSubscriptionMatchKey(rightRaw),
    );
    expect(sessionSubscriptionMatchKey(left)).toBe(
      sessionSubscriptionMatchKey(right),
    );
  });

  it("canonicalizes nested match data for storage", () => {
    const value = sessionSubscriptionMatchValue({
      b: 1,
      a: { y: true, x: false },
    });
    expect(value).toEqual({
      a: { x: false, y: true },
      b: 1,
    });
    expect(sessionSubscriptionMatchKey(value)).toBe(
      sessionSubscriptionMatchKey({
        a: { x: false, y: true },
        b: 1,
      }),
    );
  });

  it("uses empty match key for unfiltered subscriptions", () => {
    expect(sessionSubscriptionMatchKey(undefined)).toBe("");
    expect(sessionSubscriptionMatchValue(undefined)).toBeUndefined();
  });
});
