import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  fallback,
  isFallback,
  classifyError,
  shouldAttemptFallback,
} from "../src/generation/fallback";
import {
  CruxAdapterError,
  cruxProviderError,
} from "../src/adapter/normalized-outcome";
import { ValidationExhaustedError } from "../src/generation/validation-retry";
import { createGeneratedImageResult } from "../src/generation/image-result";
import { createNoTranscriptError } from "../src/transcription/errors";
import { RequestCompositionError } from "../src/request/errors";
import { FallbackExhaustedError } from "../src/routing/errors";
import { createRoutingReceipt } from "../src/routing/receipt";

describe("fallback()", () => {
  it("returns a FallbackModel with correct _tag and models", () => {
    const modelA = { provider: "openai", modelId: "gpt-4o" };
    const modelB = { provider: "anthropic", modelId: "claude-sonnet" };
    const fb = fallback([modelA, modelB]);

    expect(fb._tag).toBe("crux.fallback");
    expect(fb.models).toEqual([modelA, modelB]);
  });

  it("accepts 3+ models", () => {
    const fb = fallback(["model-a", "model-b", "model-c"]);
    expect(fb.models).toEqual(["model-a", "model-b", "model-c"]);
  });

  it("extracts options object from last argument", () => {
    const fb = fallback(["model-a", "model-b"], {
      id: "resilient-model",
      description: "Try backup providers on provider failures",
      on: ["rate_limit", "timeout"],
      timeout: { attempt: 5000 },
    });

    expect(fb.models).toEqual(["model-a", "model-b"]);
    expect(fb.options.id).toBe("resilient-model");
    expect(fb.options.description).toBe(
      "Try backup providers on provider failures",
    );
    expect(fb.options.on).toEqual(["rate_limit", "timeout"]);
    expect(fb.options.timeout).toEqual({ attempt: 5000 });
  });

  it("keeps model objects with option-like metadata in the model list", () => {
    const modelA = { provider: "openai", modelId: "gpt-4o" };
    const modelB = {
      id: "custom-model",
      description: "SDK model object with metadata",
      doGenerate: async () => ({ text: "ok" }),
    };
    const fb = fallback([modelA, modelB]);

    expect(fb.models).toEqual([modelA, modelB]);
    expect(fb.options).toEqual({});
  });

  it("defaults options when none provided", () => {
    const fb = fallback(["a", "b"]);
    expect(fb.options).toEqual({});
  });

  it("throws when fewer than 2 models are provided", () => {
    expect(() => fallback(["only-one"] as unknown as [string, string])).toThrow(
      /at least 2 models/,
    );
  });

  it("supports onFallback callback in options", () => {
    const handler = () => {};
    const fb = fallback(["a", "b"], { onFallback: handler });
    expect(fb.options.onFallback).toBe(handler);
  });
});

describe("isFallback()", () => {
  it("returns true for FallbackModel", () => {
    const fb = fallback(["a", "b"]);
    expect(isFallback(fb)).toBe(true);
  });

  it("returns false for regular model objects", () => {
    expect(isFallback({ provider: "openai", modelId: "gpt-4o" })).toBe(false);
  });

  it("returns false for strings", () => {
    expect(isFallback("gpt-4o")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isFallback(null)).toBe(false);
    expect(isFallback(undefined)).toBe(false);
  });
});

describe("classifyError()", () => {
  it("classifies REQUEST_TOO_LARGE through bounded cycle-safe causes", () => {
    const requestError = new RequestCompositionError(
      "REQUEST_TOO_LARGE",
      "request does not fit",
      [],
      "req_1",
    );
    const wrapper = new Error("adapter wrapped", { cause: requestError });
    (requestError as { cause?: unknown }).cause = wrapper;

    expect(classifyError(wrapper)).toBe("input_limit");
  });

  it("does not classify unrelated request composition errors", () => {
    const requestError = new RequestCompositionError(
      "INVALID_COMPOSITION",
      "composition failed",
      [],
      "req_1",
    );

    expect(classifyError(requestError)).toBeNull();
  });

  it("classifies nonempty unanimous exhausted error collections only", () => {
    const inputLimit = new RequestCompositionError(
      "REQUEST_TOO_LARGE",
      "request does not fit",
      [],
      "req_1",
    );
    const timeout = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    const emptyRouting = createRoutingReceipt("fallback", undefined, []);

    expect(
      classifyError(
        new FallbackExhaustedError([], emptyRouting, [inputLimit, inputLimit]),
      ),
    ).toBe("input_limit");
    expect(
      classifyError(
        new FallbackExhaustedError([], emptyRouting, [inputLimit, timeout]),
      ),
    ).toBeNull();
    expect(
      classifyError(new FallbackExhaustedError([], emptyRouting, [])),
    ).toBeNull();
    expect(classifyError(new AggregateError([inputLimit]))).toBe(
      "input_limit",
    );
    expect(classifyError(new AggregateError([]))).toBeNull();
  });

  it("classifies normalized adapter failures without provider-specific status fields", () => {
    expect(
      classifyError(
        new CruxAdapterError(
          cruxProviderError({
            kind: "rate-limit",
            code: "ai-sdk.rate_limit",
            retryable: true,
          }),
        ),
      ),
    ).toBe("rate_limit");
  });

  it("classifies HTTP 429 as rate_limit", () => {
    const err = Object.assign(new Error("Too Many Requests"), { status: 429 });
    expect(classifyError(err)).toBe("rate_limit");
  });

  it("classifies HTTP 500 as server_error", () => {
    const err = Object.assign(new Error("Internal Server Error"), {
      status: 500,
    });
    expect(classifyError(err)).toBe("server_error");
  });

  it("classifies HTTP 502 as server_error", () => {
    const err = Object.assign(new Error("Bad Gateway"), { status: 502 });
    expect(classifyError(err)).toBe("server_error");
  });

  it("classifies HTTP 503 as server_error", () => {
    const err = Object.assign(new Error("Service Unavailable"), {
      status: 503,
    });
    expect(classifyError(err)).toBe("server_error");
  });

  it("classifies HTTP 401 as auth_error", () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    expect(classifyError(err)).toBe("auth_error");
  });

  it("classifies HTTP 403 as auth_error", () => {
    const err = Object.assign(new Error("Forbidden"), { status: 403 });
    expect(classifyError(err)).toBe("auth_error");
  });

  it("classifies ETIMEDOUT as timeout", () => {
    const err = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    expect(classifyError(err)).toBe("timeout");
  });

  it("classifies AbortError as timeout", () => {
    const err = new DOMException("signal is aborted", "AbortError");
    expect(classifyError(err)).toBe("timeout");
  });

  it("classifies ECONNREFUSED as connection_error", () => {
    const err = Object.assign(new Error("connect failed"), {
      code: "ECONNREFUSED",
    });
    expect(classifyError(err)).toBe("connection_error");
  });

  it("classifies ENOTFOUND as connection_error", () => {
    const err = Object.assign(new Error("dns failed"), { code: "ENOTFOUND" });
    expect(classifyError(err)).toBe("connection_error");
  });

  it("classifies fetch TypeError as connection_error", () => {
    const err = new TypeError("fetch failed");
    expect(classifyError(err)).toBe("connection_error");
  });

  it("returns null for validation errors (HTTP 400)", () => {
    const err = Object.assign(new Error("Bad Request"), { status: 400 });
    expect(classifyError(err)).toBeNull();
  });

  it("returns null for unknown errors", () => {
    const err = new Error("something unexpected");
    expect(classifyError(err)).toBeNull();
  });

  it("classifies ValidationExhaustedError as invalid_response", () => {
    const zodError = z.object({ x: z.number() }).safeParse({ x: "bad" }).error!;
    const err = new ValidationExhaustedError({
      lastRawOutput: "{}",
      zodErrors: zodError,
      attempts: 3,
      maxAttempts: 3,
      promptId: "test",
    });
    expect(classifyError(err)).toBe("invalid_response");
  });

  it("classifies empty completed-media responses as invalid_response", () => {
    let noImage: unknown;
    try {
      createGeneratedImageResult([], {
        raw: {},
        warnings: [],
        execution: { kind: "native", calls: 1 },
      });
    } catch (error) {
      noImage = error;
    }

    expect(classifyError(noImage)).toBe("invalid_response");
    expect(classifyError(createNoTranscriptError())).toBe("invalid_response");
  });
});

describe("shouldAttemptFallback()", () => {
  it("returns true for classified errors with no options", () => {
    const err = Object.assign(new Error("Rate limited"), { status: 429 });
    expect(shouldAttemptFallback(err, {})).toBe(true);
  });

  it("returns false for unclassified errors", () => {
    const err = new Error("unknown");
    expect(shouldAttemptFallback(err, {})).toBe(false);
  });

  it("respects `on` filter", () => {
    const rateLimitErr = Object.assign(new Error("429"), { status: 429 });
    const serverErr = Object.assign(new Error("500"), { status: 500 });

    expect(shouldAttemptFallback(rateLimitErr, { on: ["rate_limit"] })).toBe(
      true,
    );
    expect(shouldAttemptFallback(serverErr, { on: ["rate_limit"] })).toBe(
      false,
    );
  });

  it("custom shouldFallback predicate takes priority over `on`", () => {
    const err = Object.assign(new Error("custom"), {
      status: 400,
      myCode: "content_filter",
    });

    // `on` would say no (400 is unclassified), but predicate says yes
    const result = shouldAttemptFallback(err, {
      on: ["rate_limit"],
      shouldFallback: (e: any) => e.myCode === "content_filter",
    });
    expect(result).toBe(true);
  });

  it("custom predicate can reject classified errors", () => {
    const err = Object.assign(new Error("Rate limited"), { status: 429 });

    // Would normally be classified as rate_limit, but predicate rejects
    const result = shouldAttemptFallback(err, {
      shouldFallback: () => false,
    });
    expect(result).toBe(false);
  });
});
