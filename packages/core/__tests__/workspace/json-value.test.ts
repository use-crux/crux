import { describe, expect, it } from "vitest";
import { isJsonValue } from "../../workspace/json-value";

describe("workspace JSON value guard", () => {
  it("accepts JSON primitives, arrays, and plain objects", () => {
    const nullPrototypeObject = Object.create(null) as Record<string, unknown>;
    nullPrototypeObject.ok = true;

    expect(isJsonValue(null)).toBe(true);
    expect(isJsonValue("text")).toBe(true);
    expect(isJsonValue(1)).toBe(true);
    expect(isJsonValue(false)).toBe(true);
    expect(isJsonValue(["text", 1, { nested: null }])).toBe(true);
    expect(isJsonValue({ nested: ["value"] })).toBe(true);
    expect(isJsonValue(nullPrototypeObject)).toBe(true);
  });

  it("rejects non-finite numbers, class instances, and cycles", () => {
    class CustomValue {
      value = "not plain";
    }

    const cyclicObject: Record<string, unknown> = {};
    cyclicObject.self = cyclicObject;
    const cyclicArray: unknown[] = [];
    cyclicArray.push(cyclicArray);

    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJsonValue(new Date())).toBe(false);
    expect(isJsonValue(new Map())).toBe(false);
    expect(isJsonValue(new CustomValue())).toBe(false);
    expect(isJsonValue(cyclicObject)).toBe(false);
    expect(isJsonValue(cyclicArray)).toBe(false);
  });
});
