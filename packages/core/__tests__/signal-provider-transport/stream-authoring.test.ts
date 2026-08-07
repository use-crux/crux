/**
 * Managed stream transport authoring: frozen definition, inert construction.
 */

import { describe, expect, it, vi } from "vitest";

import { stream } from "../../src/signal/transport";

describe("stream() transport authoring", () => {
  it("returns a frozen StreamTransport definition", () => {
    const open = async function* () {
      yield {
        kind: "cursor" as const,
        cursor: null,
      };
    };

    const transport = stream({ open });

    expect(transport._tag).toBe("StreamTransport");
    expect(transport.kind).toBe("stream");
    expect(transport.open).toBe(open);
    expect(Object.isFrozen(transport)).toBe(true);
  });

  it("throws TypeError when open is missing or not a function", () => {
    expect(() => stream({} as never)).toThrow(TypeError);
    expect(() => stream({ open: null } as never)).toThrow(
      /stream\(\{ open \}\) requires an open function/,
    );
    expect(() => stream({ open: "not-a-function" } as never)).toThrow(
      /stream\(\{ open \}\) requires an open function/,
    );
  });

  it("does not invoke open at construction time", () => {
    const open = vi.fn(async function* () {
      yield { kind: "cursor" as const, cursor: null };
    });

    const transport = stream({ open });

    expect(open).not.toHaveBeenCalled();
    expect(transport.open).toBe(open);
  });
});
