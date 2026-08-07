/**
 * Managed WebSocket transport authoring: frozen definition, inert construction.
 */

import { describe, expect, it, vi } from "vitest";

import { websocket } from "../../src/signal/transport";

describe("websocket() transport authoring", () => {
  it("returns a frozen WebSocketTransport definition", () => {
    const open = async function* () {
      yield {
        kind: "cursor" as const,
        cursor: null,
      };
    };

    const transport = websocket({ open });

    expect(transport._tag).toBe("WebSocketTransport");
    expect(transport.kind).toBe("websocket");
    expect(transport.open).toBe(open);
    expect(Object.isFrozen(transport)).toBe(true);
  });

  it("throws TypeError when open is missing or not a function", () => {
    expect(() => websocket({} as never)).toThrow(TypeError);
    expect(() => websocket({ open: null } as never)).toThrow(
      /websocket\(\{ open \}\) requires an open function/,
    );
    expect(() => websocket({ open: "not-a-function" } as never)).toThrow(
      /websocket\(\{ open \}\) requires an open function/,
    );
  });

  it("does not invoke open at construction time", () => {
    const open = vi.fn(async function* () {
      yield { kind: "cursor" as const, cursor: null };
    });

    const transport = websocket({ open });

    expect(open).not.toHaveBeenCalled();
    expect(transport.open).toBe(open);
  });
});
