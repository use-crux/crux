import { describe, expect, it } from "vitest";

import { canonicalPrettyPromptPreviewJson, parsePromptPreviewRaw } from "./raw";

describe("Prompt preview authoritative raw JSON", () => {
  it("accepts one strict object and preserves arrays and scalar values", () => {
    expect(
      parsePromptPreviewRaw(
        '{"name":"Ada","active":true,"items":[1,null,{"ok":false}]}',
      ),
    ).toEqual({
      name: "Ada",
      active: true,
      items: [1, null, { ok: false }],
    });
  });

  it.each([
    ['{"a":1,"a":2}', "duplicate keys"],
    ['{"nested":{"a":1,"a":2}}', "nested duplicate keys"],
    ['{"x":"\\ud800"}', "lone surrogate"],
    ['{"x":1e400}', "nonfinite number"],
    ["[]", "array root"],
    ["null", "null root"],
    ['{"x":1} trailing', "trailing token"],
  ])("rejects %s (%s)", (text) => {
    expect(parsePromptPreviewRaw(text)).toBeUndefined();
  });

  it("writes canonical UTF-16 key order without integer-key reordering", () => {
    const value = parsePromptPreviewRaw(
      '{"10":"ten","2":"two","z":{"b":2,"a":1},"items":[{"b":2,"a":1}]}',
    );
    expect(canonicalPrettyPromptPreviewJson(value!)).toBe(`{
  "10": "ten",
  "2": "two",
  "items": [
    {
      "a": 1,
      "b": 2
    }
  ],
  "z": {
    "a": 1,
    "b": 2
  }
}`);
  });

  it("uses ECMAScript scalar serialization without HTML escaping", () => {
    expect(
      canonicalPrettyPromptPreviewJson({
        negativeZero: -0,
        html: "<>&",
        separators: "\u2028\u2029",
      }),
    ).toContain('"negativeZero": 0');
    expect(
      canonicalPrettyPromptPreviewJson({
        negativeZero: -0,
        html: "<>&",
        separators: "\u2028\u2029",
      }),
    ).toContain('"<>&"');
    expect(
      canonicalPrettyPromptPreviewJson({
        negativeZero: -0,
        html: "<>&",
        separators: "\u2028\u2029",
      }),
    ).toContain('"\u2028\u2029"');
  });
});
