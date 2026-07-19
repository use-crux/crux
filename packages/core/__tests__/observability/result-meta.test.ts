import { describe, expect, it } from "vitest";

import { createCruxSpanId, createCruxTraceId } from "@use-crux/core/observability";
import { withOperationResultMeta } from "../../src/observability/internal/result-meta";
import { stampCruxRunId } from "../../src/generation/run-id";

describe("operation result metadata finalization", () => {
  it("preserves a frozen envelope's descriptors without evaluating accessors", () => {
    const symbolKey = Symbol("provider-result");
    const prototype = { kind: "provider-result" };
    let getterReads = 0;
    const result = Object.create(prototype) as {
      readonly _meta: { readonly responseId: string };
      readonly lazy: string;
      readonly [symbolKey]: string;
    };

    Object.defineProperties(result, {
      _meta: {
        configurable: false,
        enumerable: true,
        value: Object.freeze({ responseId: "response-1" }),
        writable: false,
      },
      lazy: {
        configurable: true,
        enumerable: false,
        get: () => {
          getterReads += 1;
          return "lazy";
        },
      },
      [symbolKey]: {
        configurable: true,
        enumerable: false,
        value: "symbol-value",
        writable: false,
      },
    });
    Object.freeze(result);

    const operation = Object.freeze({
      traceId: createCruxTraceId(),
      spanId: createCruxSpanId(),
    });
    const finalized = withOperationResultMeta(result, operation);

    expect(finalized).not.toBe(result);
    expect(Object.getPrototypeOf(finalized)).toBe(prototype);
    expect(getterReads).toBe(0);
    expect(Object.getOwnPropertyDescriptor(finalized, "lazy")).toEqual(
      Object.getOwnPropertyDescriptor(result, "lazy"),
    );
    expect(Object.getOwnPropertyDescriptor(finalized, symbolKey)).toEqual(
      Object.getOwnPropertyDescriptor(result, symbolKey),
    );
    expect(finalized._meta).toEqual({
      responseId: "response-1",
      ...operation,
    });
    expect(Object.isFrozen(finalized)).toBe(true);
    expect(Object.isFrozen(finalized._meta)).toBe(true);
    expect(result._meta).toEqual({ responseId: "response-1" });
  });

  it("rejects invalid result envelopes and metadata at the Crux boundary", () => {
    const operation = Object.freeze({
      traceId: createCruxTraceId(),
      spanId: createCruxSpanId(),
    });
    const finalizeUnknown = withOperationResultMeta as (
      result: unknown,
      operation: typeof operation,
    ) => unknown;

    for (const result of [
      null,
      "result",
      1,
      [],
      { _meta: null },
      { _meta: [] },
      { _meta: "metadata" },
    ]) {
      expect(() => finalizeUnknown(result, operation)).toThrowError(
        /Crux operation result boundary/,
      );
    }
  });

  it("overwrites reserved IDs and is referentially idempotent for the exact pair", () => {
    const operation = Object.freeze({
      traceId: createCruxTraceId(),
      spanId: createCruxSpanId(),
    });
    let rawReads = 0;
    const result = Object.defineProperties(
      {
        _meta: {
          responseId: "response-1",
          traceId: createCruxTraceId(),
          spanId: createCruxSpanId(),
        },
      },
      {
        raw: {
          enumerable: true,
          get: () => {
            rawReads += 1;
            return { provider: true };
          },
        },
      },
    );

    const finalized = withOperationResultMeta(result, operation);
    const finalizedAgain = withOperationResultMeta(finalized, operation);

    expect(finalized._meta).toEqual({
      responseId: "response-1",
      ...operation,
    });
    expect(finalizedAgain).toBe(finalized);
    expect(rawReads).toBe(0);
  });

  it("restamps an extensible result without redefining its immutable runId", () => {
    const firstRunId = "run-first" as Parameters<typeof stampCruxRunId>[1];
    const secondRunId = "run-second" as Parameters<typeof stampCruxRunId>[1];
    const first = stampCruxRunId({ value: 1 }, firstRunId);

    const restamped = stampCruxRunId(first, secondRunId);

    expect(restamped).not.toBe(first);
    expect(first.runId).toBe(firstRunId);
    expect(restamped).toEqual({ value: 1, runId: secondRunId });
    expect(Object.getOwnPropertyDescriptor(restamped, "runId")).toMatchObject({
      configurable: false,
      enumerable: true,
      writable: false,
    });
  });
});
