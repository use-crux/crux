/**
 * An unguarded structured stream still publishes canonical `z.input`.
 *
 * Canonicalization is not a Safety feature — it is what turns provider wire JSON
 * into the authored input type. A prompt with no guardrails and no constraints
 * must still see the manifest applied on `textStream` and `partialOutputStream`,
 * or a caller reading either surface would receive a provider lowering sentinel
 * that `completion.object` does not contain (RFC #173).
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { adapter as makeAdapter } from "../../../src/adapter/define-adapter";
import type { AdapterSpec, StreamHandle } from "../../../src/adapter/types";
import { prompt as makePrompt } from "../../../src/prompt/prompt";
import { strictCapabilities } from "./capability-fixtures";

/** A provider that streams one strict-lowered wire payload verbatim. */
function streamingAdapter(wireText: string) {
  const spec: AdapterSpec<object, never, never> = {
    providerId: "strict-native",
    structuredOutput: { accepts: strictCapabilities },
    async call() {
      throw new Error("not used");
    },
    async stream(): Promise<StreamHandle<never>> {
      async function* chunks() {
        // Split so the surfaces are exercised progressively, not as one blob.
        const half = Math.ceil(wireText.length / 2);
        yield { text: wireText.slice(0, half) };
        yield { text: wireText.slice(half) };
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

const schema = z.object({ title: z.string(), note: z.string().optional() });
const structuredPrompt = makePrompt({
  id: "unguarded-structured-stream",
  prompt: "return json",
  output: schema,
});

describe("unguarded structured stream — canonicalization", () => {
  it("publishes canonical input, not the provider's sentinel null", async () => {
    // `requiresAllProperties` forces the absent optional onto the wire as null.
    const result = await streamingAdapter('{"title":"a","note":null}').stream(
      structuredPrompt,
      { model: "strict-model" },
    );

    const [text, partials] = await Promise.all([
      (async () => {
        let seen = "";
        for await (const delta of result.textStream) seen += delta;
        return seen;
      })(),
      (async () => {
        const seen: unknown[] = [];
        for await (const partial of result.partialOutputStream) seen.push(partial);
        return seen;
      })(),
    ]);
    const completion = await result.completion;

    // No guardrails, no constraints — and still canonical.
    expect(text).toBe('{"title":"a"}');
    expect(JSON.parse(text)).toEqual({ title: "a" });
    expect(partials.at(-1)).toEqual({ title: "a" });
    // The published surfaces agree with the validated object rather than
    // describing a value it never contained.
    expect(completion.object).toEqual({ title: "a" });
  });
});
