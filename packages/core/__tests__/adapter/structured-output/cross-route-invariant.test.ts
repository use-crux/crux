/**
 * Cross-route structured-output invariant.
 *
 * Switching a structured prompt between the core-driven `AdapterSpec` route and
 * the SDK-driven `LoopRuntimePort` route must enforce the identical completed
 * candidate pipeline:
 *
 * ```text
 * provider wire value -> manifest decode to z.input -> Safety over z.input
 *   -> authored Zod safeParse exactly once -> safeParse.data as z.output
 * ```
 *
 * These tests pin the behaviors that were previously SDK-route gaps: core owns
 * compilation and the sole authored parse, the SDK never runs the authored Zod
 * validator, defaults/transforms apply exactly once, and an unknown model fails
 * before any provider I/O.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { adapter as makeAdapter } from "../../../src/adapter/define-adapter";
import { loopRuntimeAdapter } from "../../../src/adapter/define-executor";
import { fakeLoopRuntime } from "../../../src/adapter/testing";
import type { LoopRuntimePort } from "../../../src/adapter/loop-runtime-port";
import type { AdapterResponse, AdapterSpec } from "../../../src/adapter/types";
import type { StructuredRequest } from "../../../src/adapter/executor-types";
import { prompt as makePrompt } from "../../../src/prompt/prompt";
import { CruxUnsupportedStructuredOutputError } from "../../../src/adapter/structured-output";
import { permissiveCapabilities } from "./capability-fixtures";

/** A one-shot core-driven adapter that returns fixed structured text. */
function nativeAdapter(text: string) {
  const raw: AdapterResponse = { text, finishReason: "stop" };
  const spec: AdapterSpec<object, AdapterResponse, never> = {
    providerId: "native-parity",
    structuredOutput: { accepts: permissiveCapabilities },
    async call() {
      return { raw, extracted: raw };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (m) => m,
    mapSettings: () => ({}),
  };
  return makeAdapter(spec)({});
}

describe("structured output — cross-route invariant", () => {
  it("returns identical objects from the native and SDK routes, applying defaults and transforms once", async () => {
    let transforms = 0;
    const schema = z.object({
      count: z.coerce.number().default(7),
      label: z.string().transform((value) => {
        transforms += 1;
        return value.toUpperCase();
      }),
    });
    const structured = makePrompt({
      id: "cross-route-defaults",
      prompt: "return json",
      output: schema,
    });
    // `count` is omitted so the authored default must be applied by core, and
    // `label` must be transformed — neither of which a wire-schema SDK does.
    const wireText = '{"label":"hi"}';

    const native = await nativeAdapter(wireText).generate(structured, {
      model: "m",
    });
    const sdk = await loopRuntimeAdapter(
      fakeLoopRuntime({ structured: [wireText] }).runtime,
    ).generate(structured, { model: "fake:m" });

    expect(native.object).toEqual({ count: 7, label: "HI" });
    expect(sdk.object).toEqual(native.object);
    // One completed candidate per route → exactly one authored transform each.
    expect(transforms).toBe(2);
  });

  it("returns the same object from SDK generate and SDK stream completion", async () => {
    const schema = z.object({
      count: z.coerce.number().default(3),
      label: z.string().transform((value) => value.toUpperCase()),
    });
    const structured = makePrompt({
      id: "cross-route-generate-stream",
      prompt: "return json",
      output: schema,
    });
    const wireText = '{"label":"hi"}';

    const generated = await loopRuntimeAdapter(
      fakeLoopRuntime({ structured: [wireText] }).runtime,
    ).generate(structured, { model: "fake:m" });

    const streamed = await loopRuntimeAdapter(
      fakeLoopRuntime({ streams: [[wireText]] }).runtime,
    ).stream(structured, { model: "fake:m" });
    const completion = await streamed.completion();

    expect(generated.object).toEqual({ count: 3, label: "HI" });
    expect((completion as { object?: unknown }).object).toEqual(
      generated.object,
    );
  });

  it("installs the compiled wire schema on the SDK request, never the authored Zod validator", async () => {
    const seen: Array<StructuredRequest<string>> = [];
    const fake = fakeLoopRuntime({ structured: ['{"ok":true}'] });
    const runtime: LoopRuntimePort<string, unknown, unknown> = {
      ...fake.runtime,
      runStructuredAttempt: (request) => {
        seen.push(request as StructuredRequest<string>);
        return fake.runtime.runStructuredAttempt(request);
      },
    };
    const structured = makePrompt({
      id: "cross-route-wire-schema",
      prompt: "return json",
      output: z.object({ ok: z.boolean() }),
    });

    await loopRuntimeAdapter(runtime).generate(structured, { model: "fake:m" });

    expect(seen).toHaveLength(1);
    // Core compiled and installed the wire schema before transport.
    expect(seen[0]!.outputSchema).toBeDefined();
    expect(seen[0]!.outputSchema).toMatchObject({ type: "object" });
  });

  it("fails before any provider I/O when the model has no verified capability profile", async () => {
    const fake = fakeLoopRuntime({ structured: ['{"ok":true}'] });
    // A runtime whose resolver cannot vouch for the selected model.
    const runtime: LoopRuntimePort<string, unknown, unknown> = {
      ...fake.runtime,
      structuredOutput: { capabilities: () => undefined },
    };
    const structured = makePrompt({
      id: "cross-route-unsupported",
      prompt: "return json",
      output: z.object({ ok: z.boolean() }),
    });

    await expect(
      loopRuntimeAdapter(runtime).generate(structured, { model: "fake:m" }),
    ).rejects.toBeInstanceOf(CruxUnsupportedStructuredOutputError);
    // The provider was never called.
    expect(fake.calls.runStructuredAttempt).toHaveLength(0);
  });
});
