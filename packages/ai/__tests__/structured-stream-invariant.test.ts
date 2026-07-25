/**
 * Completed structured stream invariant (AI SDK v6).
 *
 * Structured streaming uses `streamText` + `Output.object`, whose real `onFinish`
 * exposes both the streamed text and the parsed wire `output`. Core runs the
 * completed candidate through the same pipeline as generation: the wire value is
 * decoded to canonical `z.input`, guarded by the terminal object/both bindings,
 * and validated by the authored schema exactly once. These tests drive the real
 * AI SDK stream (no synthetic finish event) and assert generate ≡ stream
 * completion.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { prompt } from "@use-crux/core";
import { boundary, guardrail } from "@use-crux/core/safety";
import { createCruxAi } from "../src";
import { capturingStreamingEmissionModel, structuredModel } from "./mock-model";

async function drain(handle: {
  readonly textStream: AsyncIterable<string>;
  readonly completion: Promise<{ readonly object?: unknown }>;
}) {
  for await (const _chunk of handle.textStream) {
    // Drain before reading completion.
  }
  return handle.completion;
}

describe("completed structured stream invariant", () => {
  it("returns the same object from SDK generate and SDK stream completion", async () => {
    const structured = prompt({
      id: "stream-generate-parity",
      prompt: "return json",
      output: z.object({ name: z.string() }),
    });
    const wireText = '{"name":"x"}';

    const generated = await createCruxAi().generate(structured, {
      model: structuredModel([wireText]),
    });
    const stream = await createCruxAi().stream(structured, {
      model: capturingStreamingEmissionModel([{ text: wireText }]).model,
    });
    const completion = await drain(stream);

    expect(generated.object).toEqual({ name: "x" });
    expect(completion.object).toEqual(generated.object);
  });

  it("runs the authored transform exactly once over the wire value", async () => {
    let transforms = 0;
    const structured = prompt({
      id: "stream-transform-once",
      prompt: "return json",
      output: z.object({
        name: z.string().transform((value) => {
          transforms += 1;
          return value.toUpperCase();
        }),
      }),
    });

    const stream = await createCruxAi().stream(structured, {
      model: capturingStreamingEmissionModel([{ text: '{"name":"x"}' }]).model,
    });
    const completion = await drain(stream);

    expect(completion.object).toEqual({ name: "X" });
    expect(transforms).toBe(1);
  });

  it("applies an object-boundary rewrite to the completed stream value", async () => {
    const structured = prompt({
      id: "stream-object-guard",
      prompt: "return json",
      output: z.object({ name: z.string() }),
    });
    const guardrails = [
      guardrail({
        id: "rewrite-structured-object",
        on: boundary.output.object<{ name: string }>(),
        run: () => ({
          action: "rewrite" as const,
          value: { name: "REWRITTEN" },
          rewrite: { kind: "normalize" as const },
        }),
      }),
    ];

    const generated = await createCruxAi().generate(structured, {
      model: structuredModel(['{"name":"x"}']),
      guardrails,
    });
    const stream = await createCruxAi().stream(structured, {
      model: capturingStreamingEmissionModel([{ text: '{"name":"x"}' }]).model,
      guardrails,
    });
    const completion = await drain(stream);

    expect(generated.object).toEqual({ name: "REWRITTEN" });
    expect(completion.object).toEqual({ name: "REWRITTEN" });
  });

  it("streams canonical JSON (sentinel deleted, path rewritten) and parses once", async () => {
    // A strict profile (openai) lowers the optional-only `note` to required+nullable
    // and records a `delete-null-sentinel` op; the provider emits the null sentinel.
    let authoredParses = 0;
    const structured = prompt({
      id: "stream-sentinel-rewrite",
      prompt: "return json",
      output: z.object({
        name: z.string().transform((value) => {
          authoredParses += 1;
          return value.toUpperCase();
        }),
        note: z.string().optional(),
      }),
    });
    const guardrails = [
      guardrail({
        id: "redact-name",
        on: boundary.output.object<{ name: string }>().path("name"),
        run: () => ({
          action: "rewrite" as const,
          value: "safe",
          rewrite: { kind: "redact" as const },
        }),
      }),
    ];

    const stream = await createCruxAi().stream(structured, {
      model: capturingStreamingEmissionModel([{ text: '{"name":"raw","note":null}' }]).model,
      guardrails,
    });

    let releasedText = "";
    for await (const chunk of stream.textStream) releasedText += chunk;
    const completion = await stream.completion;

    // The structured transform releases canonical JSON: the null sentinel is gone
    // (Output.object still parses it) and the path guard's rewrite is applied.
    expect(JSON.parse(releasedText)).toEqual({ name: "safe" });
    expect(releasedText).not.toContain("note");
    // Core consumes the sealed canonical object without re-decoding; the authored
    // schema (its transform) runs exactly once over it.
    expect(completion.object).toEqual({ name: "SAFE" });
    expect(authoredParses).toBe(1);
  });

  it("fails closed when an object rewrite breaks the schema", async () => {
    const structured = prompt({
      id: "stream-invalid-rewrite",
      prompt: "return json",
      output: z.object({ name: z.string() }),
    });
    const guardrails = [
      guardrail({
        id: "rewrite-structured-invalid",
        on: boundary.output.object<{ name: string }>(),
        run: () => ({
          action: "rewrite" as const,
          value: { name: 123 } as unknown as { name: string },
          rewrite: { kind: "normalize" as const },
        }),
      }),
    ];

    const stream = await createCruxAi().stream(structured, {
      model: capturingStreamingEmissionModel([{ text: '{"name":"x"}' }]).model,
      guardrails,
    });

    await expect(drain(stream)).rejects.toThrow();
  });
});
