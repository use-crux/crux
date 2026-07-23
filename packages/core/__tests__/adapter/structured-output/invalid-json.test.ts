/**
 * Invalid provider JSON must fail closed, even under permissive root schemas.
 *
 * A JSON parse failure must enter the normal validation-failure/retry path and
 * must never succeed merely because the authored schema accepts `undefined`
 * (`z.any()`, `z.unknown()`, `.optional()`, `.default()`).
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createStructuredFakeAdapter,
  structuredFixturePrompt,
} from "./normalization-fixtures";

const input = { message: "hi" } as const;

describe("invalid JSON fails closed under permissive root schemas", () => {
  const permissiveRoots = {
    "z.any()": z.any(),
    "z.unknown()": z.unknown(),
    "optional object": z.object({ a: z.string() }).optional(),
    "defaulted object": z.object({ a: z.string() }).default({ a: "x" }),
  } as const;

  for (const [label, schema] of Object.entries(permissiveRoots)) {
    it(`rejects invalid JSON for ${label} without validationRetry`, async () => {
      const run = createStructuredFakeAdapter("not valid json").generate(
        structuredFixturePrompt(`invalid-json-${label}`, schema),
        { model: "m", input },
      );
      await expect(run).rejects.toThrow();
    });
  }

  it("retries invalid JSON when validationRetry is configured, then exhausts", async () => {
    const onExhausted = vi.fn();
    const run = createStructuredFakeAdapter("still not json").generate(
      structuredFixturePrompt("invalid-json-retry", z.any()),
      {
        model: "m",
        input,
        validationRetry: { maxRetries: 1, onExhausted },
      },
    );
    await expect(run).rejects.toMatchObject({ name: "ValidationExhaustedError" });
    expect(onExhausted).toHaveBeenCalledOnce();
  });
});
