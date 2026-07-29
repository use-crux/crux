import { describe, expect, it } from "vitest";

import { parseStrictWireJson } from "./strict-wire-json";

describe("strict wire JSON parsing", () => {
  it("preserves duplicate-key evidence before native decoding", () => {
    expect(() => parseStrictWireJson('{"a":1,"a":2}', 100)).toThrow();
    expect(() => parseStrictWireJson('{"outer":{"a":1,"a":2}}', 100)).toThrow();
  });

  it("accepts exact UTF-8 byte equality and rejects overflow", () => {
    expect(parseStrictWireJson('{"x":"😀"}', 12)).toEqual({ x: "😀" });
    expect(() => parseStrictWireJson('{"x":"😀"}', 11)).toThrow();
  });
});
