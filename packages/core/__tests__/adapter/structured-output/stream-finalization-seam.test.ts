/**
 * Every stream route reaches the ONE finalization seam (RFC #173, laws 1 and 6).
 *
 * The seam is `guardStreamCompletion` → `createStructuredCompletion().finalize()`
 * → `finalizeSafetySessionLanguageOutput`. These pin what a caller can actually
 * observe about it: the authored schema is applied exactly once per logical
 * operation on every route, so a `.transform()` that counts, allocates, or logs
 * cannot fire twice — including when a live stream already committed a candidate
 * and completion republishes that same parse.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { adapter as makeAdapter } from "../../../src/adapter/define-adapter";
import type { AdapterSpec, StreamHandle } from "../../../src/adapter/types";
import { prompt as makePrompt } from "../../../src/prompt/prompt";
import { boundary, constraint } from "../../../src/safety";
import { permissiveCapabilities } from "./capability-fixtures";

/** A native adapter that streams the given payloads, one per attempt. */
function streamingAdapter(payloads: readonly string[]) {
  const queue = [...payloads];
  const spec: AdapterSpec<object, never, never> = {
    providerId: "seam-native",
    structuredOutput: { accepts: permissiveCapabilities },
    async call() {
      throw new Error("not used");
    },
    async stream(): Promise<StreamHandle<never>> {
      const payload = queue.shift() ?? payloads[payloads.length - 1] ?? "{}";
      async function* chunks() {
        yield { text: payload };
      }
      return {
        rawStream: chunks() as never,
        extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
        completion: async () => ({ finishReason: "stop" as const }),
      };
    },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };
  return makeAdapter(spec)({});
}

/** A schema whose transform is observable, so double-parsing is detectable. */
function countingSchema() {
  let transforms = 0;
  const schema = z.object({
    title: z.string().transform((value) => {
      transforms += 1;
      return value.toUpperCase();
    }),
    count: z.number(),
  });
  return { schema, transforms: () => transforms };
}

describe("stream finalization seam", () => {
  it("applies the authored schema exactly once on an ordinary stream", async () => {
    const { schema, transforms } = countingSchema();
    const result = await streamingAdapter(['{"title":"a","count":2}']).stream(
      makePrompt({ id: "seam-ordinary", prompt: "json", output: schema }),
      { model: "seam-model" },
    );

    for await (const _delta of result.textStream) void _delta;
    const completion = await result.completion;

    expect(completion.object).toEqual({ title: "A", count: 2 });
    expect(transforms()).toBe(1);
  });

  it("applies it exactly once on a coordinated stream that retried", async () => {
    const { schema, transforms } = countingSchema();
    const countPositive = constraint({
      id: "count-positive",
      on: boundary.output.object<{ title: string; count: number }>(),
      run: (value: { title: string; count: number }) =>
        value.count > 0
          ? { pass: true }
          : { pass: false, feedback: "count must be positive" },
    });

    const result = await streamingAdapter([
      '{"title":"a","count":-1}',
      '{"title":"a","count":2}',
    ]).stream(
      makePrompt({ id: "seam-coordinated", prompt: "json", output: schema }),
      { model: "seam-model", constraints: [countPositive] },
    );

    let text = "";
    for await (const delta of result.textStream) text += delta;
    const completion = await result.completion;

    // Only the accepted attempt published, and completion republished the parse
    // its validation gate already committed rather than running a second one.
    expect(text).toBe('{"title":"a","count":2}');
    expect(completion.object).toEqual({ title: "A", count: 2 });
    // ONE authored parse for the whole logical operation. The discarded attempt
    // does not contribute one either: an object constraint judges canonical
    // `z.input`, so a rejected candidate is never run through the authored
    // schema at all.
    expect(transforms()).toBe(1);
  });

  it("applies it exactly once when a validation-retry gate is installed", async () => {
    const { schema, transforms } = countingSchema();
    const result = await streamingAdapter(['{"title":"a","count":2}']).stream(
      makePrompt({ id: "seam-validating", prompt: "json", output: schema }),
      { model: "seam-model", validationRetry: { maxRetries: 1 } },
    );

    for await (const _delta of result.textStream) void _delta;
    const completion = await result.completion;

    // The gate parses to decide whether to commit; completion must consume that
    // parse rather than re-running the transform over the same candidate.
    expect(completion.object).toEqual({ title: "A", count: 2 });
    expect(transforms()).toBe(1);
  });
});
