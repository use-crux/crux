/**
 * Managed SSE transport authoring: frozen definition, inert construction.
 */

import { describe, expect, it, vi } from "vitest";

import { sse } from "../../src/signal/transport";

describe("sse() transport authoring", () => {
  it("returns a frozen SseTransport definition", () => {
    const open = async function* () {
      yield {
        kind: "cursor" as const,
        lastEventId: null,
      };
    };

    const transport = sse({ open });

    expect(transport._tag).toBe("SseTransport");
    expect(transport.kind).toBe("sse");
    expect(transport.open).toBe(open);
    expect(Object.isFrozen(transport)).toBe(true);
  });

  it("throws TypeError when open is missing or not a function", () => {
    expect(() => sse({} as never)).toThrow(TypeError);
    expect(() => sse({ open: null } as never)).toThrow(
      /sse\(\{ open \}\) requires an open function/,
    );
    expect(() => sse({ open: "not-a-function" } as never)).toThrow(
      /sse\(\{ open \}\) requires an open function/,
    );
  });

  it("does not invoke open at construction time", () => {
    const open = vi.fn(async function* () {
      yield { kind: "cursor" as const, lastEventId: null };
    });

    const transport = sse({ open });

    expect(open).not.toHaveBeenCalled();
    expect(transport.open).toBe(open);
  });
});
