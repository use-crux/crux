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
