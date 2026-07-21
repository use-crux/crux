/** AI SDK-native one-shot application of guarded system-prefix amendments. */

import { describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import {
  systemMessagePrefixPatch,
  type ExecutorRequest,
  type SystemMessagePrefixPatch,
} from "@use-crux/core/adapter";
import { createLoopCallPlan } from "../src/sdk-codec/loop";
import { applyAiSdkSystemMessagePrefixPatch } from "../src/sdk-codec/system-prefix-patch";

describe("AI SDK retrieval input Safety — skill amendments", () => {
  it("buffers the private patch for exactly one prepareStep", async () => {
    const patch = replacementPatch();
    const request = loopRequest({
      onStepEnd: async () => ({
        kind: "amend",
        [systemMessagePrefixPatch]: patch,
        refundStep: true,
      }),
    });
    const plan = createLoopCallPlan(request);
    const callbacks = plan.args as unknown as {
      readonly onStepFinish: (step: NativeFinishedStep) => Promise<void>;
      readonly prepareStep: (step: {
        readonly model: LanguageModel;
        readonly messages: readonly unknown[];
      }) => Record<string, unknown> | Promise<Record<string, unknown>>;
    };
    await callbacks.onStepFinish(finishedStep());

    const assistant = { role: "assistant", content: "loading" };
    const messages = [
      {
        role: "system",
        content: "safe retrieval\n\ntrusted suffix",
        providerOptions: { provider: { cacheControl: "ephemeral" } },
      },
      assistant,
    ];
    const first = await callbacks.prepareStep({
      model: request.model,
      messages,
    });
    const patched = first.messages as Array<Record<string, unknown>>;
    expect(patched[0]).toEqual({
      role: "system",
      content: "updated retrieval\n\ntrusted suffix",
      providerOptions: { provider: { cacheControl: "ephemeral" } },
    });
    expect(patched[1]).toBe(assistant);

    const second = await callbacks.prepareStep({
      model: request.model,
      messages: patched,
    });
    expect(second).not.toHaveProperty("messages");
  });

  it("preserves opaque native message identity around a direct patch", () => {
    const custom = {
      role: "assistant",
      content: [{ type: "custom", value: { provider: "opaque" } }],
    };
    const result = applyAiSdkSystemMessagePrefixPatch(
      [{ role: "system", content: "safe retrieval\n\ntrusted suffix" }, custom],
      replacementPatch(),
    );

    expect(result[1]).toBe(custom);
  });
});

interface NativeFinishedStep {
  readonly text: string;
  readonly toolCalls: readonly never[];
  readonly toolResults: readonly never[];
  readonly content: readonly never[];
}

function finishedStep(): NativeFinishedStep {
  return { text: "loading", toolCalls: [], toolResults: [], content: [] };
}

function replacementPatch(): SystemMessagePrefixPatch {
  return {
    kind: "replace",
    targetMessageIndex: 0,
    expectedPrefix: "safe retrieval\n\n",
    replacementPrefix: "updated retrieval\n\n",
  };
}

function loopRequest(
  observer: ExecutorRequest<LanguageModel>["observer"],
): ExecutorRequest<LanguageModel> {
  return {
    model: {} as LanguageModel,
    modelInfo: { provider: "test", modelId: "model" },
    system: undefined,
    systemBlocks: undefined,
    prompt: undefined,
    messages: [
      {
        role: "system",
        content: "safe retrieval\n\ntrusted suffix",
      },
    ],
    settings: {},
    tools: undefined,
    activeTools: undefined,
    maxSteps: 1,
    observer,
    abortSignal: undefined,
    extra: undefined,
  };
}
