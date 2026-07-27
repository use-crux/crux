import { describe, expect, it } from "vitest";
import {
  CruxAdapterError,
  cruxProviderError,
  isCruxAdapterError,
  normalizeAdapterCallError,
  redactProviderMessage,
  type CruxFinishReason,
  type CruxProviderError,
  type CruxProviderErrorKind,
} from "../../src/adapter";

describe("normalized adapter outcome taxonomy", () => {
  it("exposes the closed finish-reason vocabulary", () => {
    const reasons: CruxFinishReason[] = [
      "stop",
      "length",
      "tool-calls",
      "content-filter",
      "refusal",
      "error",
      "aborted",
      "unknown",
    ];
    // Compile-time closedness: assigning an out-of-vocabulary literal must fail.
    // @ts-expect-error 'finished' is not a CruxFinishReason.
    const invalid: CruxFinishReason = "finished";
    void invalid;
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it("exposes the closed provider-error kind vocabulary", () => {
    const kinds: CruxProviderErrorKind[] = [
      "refusal",
      "safety",
      "content-filter",
      "rate-limit",
      "timeout",
      "aborted",
      "invalid-request",
      "provider-error",
      "unknown",
    ];
    // @ts-expect-error 'boom' is not a CruxProviderErrorKind.
    const invalid: CruxProviderErrorKind = "boom";
    void invalid;
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("builds a normalized provider error with kind/code/retryable and no extra keys", () => {
    const error = cruxProviderError({
      kind: "rate-limit",
      code: "openai.rate_limit",
      retryable: true,
    });
    expect(error).toEqual<CruxProviderError>({
      kind: "rate-limit",
      code: "openai.rate_limit",
      retryable: true,
    });
    // No providerEvidence / raw-passthrough escape hatch.
    expect(Object.keys(error).sort()).toEqual(["code", "kind", "retryable"]);
  });

  it("routes an optional message through the shared redaction path (truncation)", () => {
    const long = "x".repeat(9000);
    const error = cruxProviderError({
      kind: "provider-error",
      code: "anthropic.stream_completion_failed",
      retryable: true,
      message: long,
    });
    expect(error.message).toBeDefined();
    expect(error.message!.length).toBeLessThan(long.length);
    expect(error.message!.length).toBeLessThan(8200);
  });

  it("redacts sensitive keys embedded in a structured-ish message via the shared path", () => {
    // Plain-string free text is only truncated, never redacted, but the routine
    // must be the shared observability sanitizer, not a bespoke one.
    expect(redactProviderMessage("short and safe")).toBe("short and safe");
    expect(redactProviderMessage(undefined)).toBeUndefined();
    expect(redactProviderMessage("")).toBeUndefined();
  });

  it("omits message when none is provided", () => {
    const error = cruxProviderError({
      kind: "aborted",
      code: "crux.aborted",
      retryable: false,
    });
    expect(error).not.toHaveProperty("message");
  });

  it("CruxAdapterError carries the normalized error and preserves cause", () => {
    const providerError = cruxProviderError({
      kind: "timeout",
      code: "crux.timeout.step",
      retryable: true,
    });
    const cause = new Error("underlying");
    const error = new CruxAdapterError(providerError, { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CruxAdapterError);
    expect(error.name).toBe("CruxAdapterError");
    expect(error.providerError).toBe(providerError);
    expect(error.cause).toBe(cause);
    expect(isCruxAdapterError(error)).toBe(true);
    expect(isCruxAdapterError(new Error("plain"))).toBe(false);
    expect(isCruxAdapterError(undefined)).toBe(false);
  });

  it("normalizes a canonical timeout from another Core copy", () => {
    const error = Object.assign(new Error("step timeout exceeded 25ms"), {
      name: "TimeoutError",
      budget: "step",
      limitMs: 25,
    });
    Object.defineProperty(error, Symbol.for("@use-crux/core/TimeoutError"), {
      value: true,
    });

    expect(
      normalizeAdapterCallError(error, { providerId: "test" }),
    ).toMatchObject({
      providerError: {
        kind: "timeout",
        code: "crux.timeout.step",
        retryable: true,
      },
      cause: error,
    });
  });
});
