import { describe, expect, it } from "vitest";

import {
  PromptPreviewRequestValidationError,
  validatePromptPreviewRequest,
} from "../../src/runtime-bridge/prompt-preview/validate";

describe("exact prompt preview hostile programmatic input", () => {
  it.each([
    ["undefined", { value: undefined }],
    ["array hole", { value: Array(1) }],
    ["function", { value: () => undefined }],
    ["symbol", { value: Symbol("private") }],
    ["bigint", { value: 1n }],
    ["positive infinity", { value: Number.POSITIVE_INFINITY }],
    ["NaN", { value: Number.NaN }],
    ["foreign object prototype", Object.create({ private: true })],
    [
      "foreign array prototype",
      Object.setPrototypeOf(["value"], { private: true }),
    ],
    ["lone high surrogate", { value: "\ud800" }],
    ["lone low surrogate", { value: "\udc00" }],
  ])("rejects %s", (_name, input) => {
    expect(() => validatePromptPreviewRequest({ payload: { input } })).toThrow(
      PromptPreviewRequestValidationError,
    );
  });

  it("rejects an accessor without invoking it", () => {
    let invoked = false;
    const input = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => {
        invoked = true;
        return "private";
      },
    });

    expect(() => validatePromptPreviewRequest({ payload: { input } })).toThrow(
      PromptPreviewRequestValidationError,
    );
    expect(invoked).toBe(false);
  });

  it("rejects a nested foreign array before inherited behavior is observed", () => {
    let toJSONInvoked = false;
    let descriptorsRead = false;
    const prototype = Object.create(Array.prototype, {
      toJSON: {
        get: () => {
          toJSONInvoked = true;
          return () => ["private"];
        },
      },
    });
    const target = Object.setPrototypeOf(["value"], prototype);
    const input = {
      nested: new Proxy(target, {
        ownKeys(value) {
          descriptorsRead = true;
          return Reflect.ownKeys(value);
        },
      }),
    };

    expect(() => validatePromptPreviewRequest({ payload: { input } })).toThrow(
      PromptPreviewRequestValidationError,
    );
    expect(descriptorsRead).toBe(false);
    expect(toJSONInvoked).toBe(false);
  });

  it("accepts plain null-prototype objects and valid surrogate pairs", () => {
    const input = Object.assign(Object.create(null), {
      value: "\ud83d\ude00",
    });

    expect(() =>
      validatePromptPreviewRequest({ payload: { input } }),
    ).not.toThrow();
  });
});
