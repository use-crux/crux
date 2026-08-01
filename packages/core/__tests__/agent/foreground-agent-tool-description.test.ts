import { expect, it, vi } from "vitest";
import { z } from "zod";
import { adapter, prompt, type AdapterSpec } from "../../src";
import { agent } from "../../src/agent";

function stop() {
  return {
    text: "done",
    toolCalls: undefined,
    usage: undefined,
    finishReason: "stop" as const,
    responseId: undefined,
    actualModelId: "recording-model",
  };
}

it("uses the child Prompt description when exposing a foreground Agent tool", async () => {
  const child = agent({
    id: "child",
    prompt: prompt({
      id: "child-prompt",
      description: "Prompt-owned child description",
      input: z.object({ topic: z.string() }),
      prompt: () => "child",
    }),
  });
  const provider = vi.fn();
  const spec: AdapterSpec<object, object> = {
    providerId: "recording",
    async call(_client, args) {
      provider(args);
      return { raw: {}, extracted: stop() };
    },
    async stream() { throw new Error("not used"); },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };

  await adapter(spec)({}).parallel({
    id: "description-fallback",
    context: {},
    agents: {
      parent: agent({
        id: "parent",
        prompt: prompt({ id: "parent-prompt", prompt: () => "parent" }),
        tools: { child },
      }),
    },
    model: "recording-model",
  });

  expect(provider).toHaveBeenCalledOnce();
  expect(provider.mock.calls[0]?.[0].tools).toEqual([
    expect.objectContaining({ name: "child", description: "Prompt-owned child description" }),
  ]);
});

it("rejects a missing Agent and Prompt description before provider dispatch", async () => {
  const child = agent({
    id: "undescribed-child",
    prompt: prompt({ id: "undescribed-prompt", prompt: () => "child" }),
  });
  const provider = vi.fn();
  const spec: AdapterSpec<object, object> = {
    providerId: "recording",
    async call(_client, args) {
      provider(args);
      return { raw: {}, extracted: stop() };
    },
    async stream() { throw new Error("not used"); },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };

  await expect(adapter(spec)({}).parallel({
    id: "missing-description",
    context: {},
    agents: {
      parent: agent({
        id: "parent",
        prompt: prompt({ id: "parent-prompt", prompt: () => "parent" }),
        tools: { child },
      }),
    },
    model: "recording-model",
  })).rejects.toThrow('Foreground Agent tool "child" requires an Agent or Prompt description.');
  expect(provider).not.toHaveBeenCalled();
});
