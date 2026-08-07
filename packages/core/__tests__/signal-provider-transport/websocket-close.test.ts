/**
 * Pure WebSocket close-code classification helpers.
 */

import { describe, expect, it } from "vitest";

import {
  classifyWebSocketCloseCode,
  webSocketCloseErrorCode,
} from "../../src/signal/transport/websocket-close";

describe("classifyWebSocketCloseCode", () => {
  it("classifies clean close as normal", () => {
    expect(classifyWebSocketCloseCode(1000)).toBe("normal");
  });

  it("classifies protocol and policy failures as terminal", () => {
    expect(classifyWebSocketCloseCode(1002)).toBe("terminal");
    expect(classifyWebSocketCloseCode(1003)).toBe("terminal");
    expect(classifyWebSocketCloseCode(1007)).toBe("terminal");
    expect(classifyWebSocketCloseCode(1008)).toBe("terminal");
    expect(classifyWebSocketCloseCode(4001)).toBe("terminal");
    expect(classifyWebSocketCloseCode(4403)).toBe("terminal");
    expect(classifyWebSocketCloseCode(4500)).toBe("terminal");
  });

  it("classifies going-away and abnormal closes as transient", () => {
    expect(classifyWebSocketCloseCode(1001)).toBe("transient");
    expect(classifyWebSocketCloseCode(1006)).toBe("transient");
    expect(classifyWebSocketCloseCode(1011)).toBe("transient");
    expect(classifyWebSocketCloseCode(1013)).toBe("transient");
  });

  it("treats non-integer codes as transient", () => {
    expect(classifyWebSocketCloseCode(1000.5)).toBe("transient");
    expect(classifyWebSocketCloseCode(Number.NaN)).toBe("transient");
  });
});

describe("webSocketCloseErrorCode", () => {
  it("returns safe durable codes", () => {
    expect(webSocketCloseErrorCode(1008)).toBe("WS_CLOSE_1008");
    expect(webSocketCloseErrorCode(4001)).toBe("WS_CLOSE_4001");
  });

  it("falls back for pathological inputs", () => {
    expect(webSocketCloseErrorCode(Number.NaN)).toBe("WS_CLOSE_UNKNOWN");
    expect(webSocketCloseErrorCode(99999)).toBe("WS_CLOSE_UNKNOWN");
  });
});
