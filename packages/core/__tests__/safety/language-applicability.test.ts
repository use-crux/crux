/** Language generation and stream Safety boundary applicability. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import type { AdapterSpec } from "../../src/adapter/spec";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import { prompt } from "../../src/prompt/prompt";
import { resetHooks, setHooks } from "../../src/runtime/runtime";
import { boundary, guardrail, SafetyConfigError } from "../../src/safety";

const textPrompt = prompt({ id: "language-applicability", prompt: "say hi" });

afterEach(() => resetHooks());

describe("language Safety applicability", () => {
  it("rejects an object guard on SDK text generation before provider I/O", async () => {
    const fake = fakeLoopRuntime({ loops: [[{ text: "hi" }]] });

    await expect(
      loopRuntimeAdapter(fake.runtime).generate(textPrompt, {
        model: "fake:text-model",
        guardrails: [inapplicableObjectGuard("sdk-generate-object")],
      }),
    ).rejects.toBeInstanceOf(SafetyConfigError);

    expect(fake.calls.runTextLoop).toHaveLength(0);
  });

  it("rejects a combined guard on SDK text streaming before provider I/O", async () => {
    const fake = fakeLoopRuntime({ streams: [["hi"]] });

    await expect(
      loopRuntimeAdapter(fake.runtime).stream(textPrompt, {
        model: "fake:text-model",
        guardrails: [inapplicableBothGuard("sdk-stream-both")],
      }),
    ).rejects.toBeInstanceOf(SafetyConfigError);

    expect(fake.calls.runStream).toHaveLength(0);
  });

  it("rejects impossible local output bindings in both Core entry points", async () => {
    const calls = { generate: 0, stream: 0 };
    const runtime = adapter(coreSpec(calls))({
      kind: "language-applicability",
    });

    await expect(
      runtime.generate(textPrompt, {
        model: "text-model",
        guardrails: [inapplicableObjectGuard("core-generate-object")],
      }),
    ).rejects.toBeInstanceOf(SafetyConfigError);
    await expect(
      runtime.stream(textPrompt, {
        model: "text-model",
        guardrails: [inapplicableBothGuard("core-stream-both")],
      }),
    ).rejects.toBeInstanceOf(SafetyConfigError);

    expect(calls).toEqual({ generate: 0, stream: 0 });
  });

  it("retains an impossible global binding as dormant audit", async () => {
    const run = vi.fn(() => ({ action: "allow" as const }));
    setHooks({
      globalGuardrails: [
        guardrail({
          id: "global-object-policy",
          on: boundary.output.object<{ value: string }>(),
          run,
        }),
      ],
    });
    const fake = fakeLoopRuntime({ loops: [[{ text: "hi" }]] });

    const result = await loopRuntimeAdapter(fake.runtime).generate(textPrompt, {
      model: "fake:text-model",
    });

    expect(run).not.toHaveBeenCalled();
    expect(result._meta.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: "global-object-policy",
        boundary: "model.output.object",
        action: "dormant",
      }),
    );
  });
});

function inapplicableObjectGuard(id: string) {
  return guardrail({
    id,
    on: boundary.output.object<{ value: string }>(),
    run: () => ({ action: "allow" }),
  });
}

function inapplicableBothGuard(id: string) {
  return guardrail({
    id,
    on: boundary.output.both<{ value: string }>(),
    run: () => ({ action: "allow" }),
  });
}

function coreSpec(calls: {
  generate: number;
  stream: number;
}): AdapterSpec<
  { readonly kind: "language-applicability" },
  { readonly text: string },
  AsyncIterable<{ readonly text: string }>
> {
  return {
    providerId: "language-applicability",
    async call() {
      calls.generate += 1;
      return {
        raw: { text: "hi" },
        extracted: {
          text: "hi",
          usage: undefined,
          finishReason: "stop",
          responseId: undefined,
          actualModelId: undefined,
        },
      };
    },
    async stream() {
      calls.stream += 1;
      throw new Error("provider stream must not start");
    },
    appendToolRound: (messages) => messages,
    mapSettings: (settings) => ({ ...settings }),
  };
}
