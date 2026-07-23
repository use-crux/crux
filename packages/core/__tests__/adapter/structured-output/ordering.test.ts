/**
 * Completed-attempt ordering for structured output.
 *
 * The authoritative Zod parse runs exactly once per completed candidate, after
 * terminal guardrails and before constraints. Guardrails therefore observe the
 * canonical `z.input`, while `result.object` is the post-Zod `safeParse.data`.
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { boundary, guardrail } from "../../../src/safety";
import {
  createStructuredFakeAdapter,
  structuredFixturePrompt,
} from "./normalization-fixtures";

const input = { message: "hi" } as const;

describe("structured completion ordering", () => {
  it("runs the authoritative safeParse exactly once per completed candidate", async () => {
    const schema = z.object({ answer: z.number() });
    const safeParseSpy = vi.spyOn(schema, "safeParse");

    await createStructuredFakeAdapter('{"answer":1}').generate(
      structuredFixturePrompt("one-parse", schema),
      { model: "m", input },
    );

    expect(safeParseSpy).toHaveBeenCalledTimes(1);
  });

  it("guards canonical z.input, then returns post-Zod safeParse.data", async () => {
    const schema = z
      .object({ answer: z.number() })
      .transform((value) => ({ ...value, doubled: value.answer * 2 }));
    let guardedObject: unknown;

    const result = await createStructuredFakeAdapter('{"answer":21}').generate(
      structuredFixturePrompt("order", schema),
      {
        model: "m",
        input,
        guardrails: [
          guardrail({
            id: "observe-object",
            on: boundary.output.both<{ answer: number }>(),
            run: (output) => {
              guardedObject = output.object;
              return { action: "allow" };
            },
          }),
        ],
      },
    );

    // The guardrail sees canonical z.input (the transform has not run yet)...
    expect(guardedObject).toEqual({ answer: 21 });
    // ...and result.object is the post-Zod output (the transform has run).
    expect(result.object).toEqual({ answer: 21, doubled: 42 });
  });
});
