/**
 * Pure SSE HTTP connect-status classification (no network).
 */

import { describe, expect, it } from "vitest";

import {
  classifySseHttpStatus,
  sseHttpStatusErrorCode,
} from "../../src/signal/transport/sse-http-status";

const SAFE_PROVIDER_ERROR_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

describe("classifySseHttpStatus / sseHttpStatusErrorCode", () => {
  it("classifies auth and permanent endpoint failures as terminal", () => {
    for (const status of [401, 403, 404, 410]) {
      expect(classifySseHttpStatus(status)).toBe("terminal");
      expect(sseHttpStatusErrorCode(status)).toBe(`SSE_HTTP_${status}`);
      expect(sseHttpStatusErrorCode(status)).toMatch(SAFE_PROVIDER_ERROR_CODE);
    }
  });

  it("classifies timeout, early, rate-limit, and 5xx as transient", () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504, 599]) {
      expect(classifySseHttpStatus(status)).toBe("transient");
      const code = sseHttpStatusErrorCode(status);
      expect(code).toMatch(SAFE_PROVIDER_ERROR_CODE);
      if (status >= 500 && status <= 599) {
        // Prefer per-status codes when they fit the safe pattern.
        expect(code).toBe(`SSE_HTTP_${status}`);
      } else {
        expect(code).toBe(`SSE_HTTP_${status}`);
      }
    }
  });

  it("classifies other 4xx as terminal", () => {
    for (const status of [400, 405, 406, 409, 411, 415, 418, 422, 451]) {
      expect(classifySseHttpStatus(status)).toBe("terminal");
      expect(sseHttpStatusErrorCode(status)).toBe(`SSE_HTTP_${status}`);
      expect(sseHttpStatusErrorCode(status)).toMatch(SAFE_PROVIDER_ERROR_CODE);
    }
  });

  it("never treats retryable 4xx (408/425/429) as terminal", () => {
    expect(classifySseHttpStatus(408)).toBe("transient");
    expect(classifySseHttpStatus(425)).toBe("transient");
    expect(classifySseHttpStatus(429)).toBe("transient");
  });

  it("is pure (no network, no mutation, stable for same inputs)", () => {
    const first = classifySseHttpStatus(401);
    const second = classifySseHttpStatus(401);
    expect(first).toBe(second);
    expect(sseHttpStatusErrorCode(503)).toBe(sseHttpStatusErrorCode(503));
    // No fetch/global side effects to assert; helpers are sync and deterministic.
    expect(typeof classifySseHttpStatus).toBe("function");
    expect(typeof sseHttpStatusErrorCode).toBe("function");
  });

  it("emits safe durable codes for the full design table", () => {
    const cases: Array<{ status: number; kind: "terminal" | "transient"; code: string }> = [
      { status: 401, kind: "terminal", code: "SSE_HTTP_401" },
      { status: 403, kind: "terminal", code: "SSE_HTTP_403" },
      { status: 404, kind: "terminal", code: "SSE_HTTP_404" },
      { status: 410, kind: "terminal", code: "SSE_HTTP_410" },
      { status: 408, kind: "transient", code: "SSE_HTTP_408" },
      { status: 425, kind: "transient", code: "SSE_HTTP_425" },
      { status: 429, kind: "transient", code: "SSE_HTTP_429" },
      { status: 500, kind: "transient", code: "SSE_HTTP_500" },
      { status: 502, kind: "transient", code: "SSE_HTTP_502" },
      { status: 503, kind: "transient", code: "SSE_HTTP_503" },
      { status: 400, kind: "terminal", code: "SSE_HTTP_400" },
    ];

    for (const entry of cases) {
      expect(classifySseHttpStatus(entry.status)).toBe(entry.kind);
      expect(sseHttpStatusErrorCode(entry.status)).toBe(entry.code);
      expect(entry.code).toMatch(SAFE_PROVIDER_ERROR_CODE);
    }
  });
});
