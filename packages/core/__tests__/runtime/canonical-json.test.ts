import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/content/sha256";
import { canonicalRuntimeJson } from "../../src/runtime/engine/canonical-json";
import type { JsonValue } from "../../src/storage";

const encoder = new TextEncoder();

describe("canonicalRuntimeJson", () => {
  it("sorts nested object keys for stable digests", () => {
    const left = canonicalRuntimeJson({
      b: 1,
      a: { y: true, x: false },
    });
    const right = canonicalRuntimeJson({
      a: { x: false, y: true },
      b: 1,
    });
    expect(left).toBe(right);
    expect(left).toBe('{"a":{"x":false,"y":true},"b":1}');
    expect(sha256Hex(encoder.encode(left))).toBe(
      sha256Hex(encoder.encode(right)),
    );
  });

  it("omits undefined object members like JSON persistence", () => {
    const value = {
      keep: 1,
      drop: undefined,
      nested: { stay: "ok", gone: undefined },
    } as JsonValue;
    expect(canonicalRuntimeJson(value)).toBe(
      '{"keep":1,"nested":{"stay":"ok"}}',
    );
    expect(canonicalRuntimeJson(value)).toBe(
      JSON.stringify({ keep: 1, nested: { stay: "ok" } }),
    );
  });

  it("serializes -0 as JSON 0 for persistence parity", () => {
    expect(canonicalRuntimeJson(-0)).toBe("0");
    expect(canonicalRuntimeJson(0)).toBe("0");
    expect(canonicalRuntimeJson({ n: -0 })).toBe('{"n":0}');
    expect(canonicalRuntimeJson(-0)).toBe(JSON.stringify(-0));
  });

  it("preserves arrays, null, strings, and booleans", () => {
    expect(canonicalRuntimeJson([1, "a", null, true, false])).toBe(
      '[1,"a",null,true,false]',
    );
    expect(canonicalRuntimeJson(null)).toBe("null");
  });

  it("compares equal across key-order variants used by work acceptance", () => {
    const left = { env: "prod", repo: "crux", flags: { b: 2, a: 1 } };
    const right = { flags: { a: 1, b: 2 }, repo: "crux", env: "prod" };
    expect(canonicalRuntimeJson(left)).toBe(canonicalRuntimeJson(right));
  });
});
