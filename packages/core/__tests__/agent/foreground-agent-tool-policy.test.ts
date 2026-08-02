import { expect, it, vi } from "vitest";
import { adapter, prompt, toolMiddleware, type AdapterSpec } from "../../src";
import { agent } from "../../src/agent";
import { boundary, guardrail } from "../../src/safety";

function toolCall(name = "child") {
  return {
    text: "",
    toolCalls: [{ id: "child-call", name, args: {} }],
    usage: undefined,
    finishReason: "tool_calls" as const,
    responseId: undefined,
    actualModelId: "recording-model",
  };
}

function child() {
  return agent({
    id: "child",
    description: "child",
    prompt: prompt({ id: "child-prompt", prompt: () => "child" }),
  });
}

it("runs ordinary Tool middleware before foreground child Work acceptance", async () => {
  const order: string[] = [];
  const provider = vi.fn();
  const spec: AdapterSpec<object, object> = {
    providerId: "recording",
    async call(_client, args) {
      provider(args);
      if (provider.mock.calls.length === 2) {
        order.push("child-provider");
        return { raw: {}, extracted: { ...toolCall(), text: "child" } };
      }
      if (provider.mock.calls.length === 1) return { raw: {}, extracted: toolCall() };
      return { raw: {}, extracted: { ...toolCall(), text: "parent", toolCalls: undefined } };
    },
    async stream() { throw new Error("not used"); },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };
  const parent = agent({
    id: "parent",
    prompt: prompt({
      id: "parent-prompt",
      prompt: () => "parent",
      toolMiddleware: toolMiddleware({
        id: "gate-child",
        match: ["child"],
        beforeExecute: () => { order.push("ordinary-tool-gate"); },
      }),
    }),
    tools: { child: child() },
  });

  await adapter(spec)({}).parallel({ id: "tool-policy", context: {}, agents: { parent }, model: "recording-model" });
  expect(order).toEqual(["ordinary-tool-gate", "child-provider"]);
});

it("requires ordinary Tool approval before accepting the child Work", async () => {
  const provider = vi.fn();
  const spec: AdapterSpec<object, object> = {
    providerId: "recording",
    async call(_client, args) {
      provider(args);
      return { raw: {}, extracted: toolCall() };
    },
    async stream() { throw new Error("not used"); },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };
  const parent = agent({
    id: "parent",
    prompt: prompt({ id: "parent-prompt", prompt: () => "parent", toolApproval: { child: "always" } }),
    tools: { child: child() },
  });

  await adapter(spec)({}).parallel({ id: "tool-approval", context: {}, agents: { parent }, model: "recording-model" });
  expect(provider).toHaveBeenCalledOnce();
  expect(provider.mock.calls.some(([args]) => args.schema)).toBe(false);
});

it("runs ordinary Tool definition guardrails before a child can be accepted", async () => {
  const provider = vi.fn();
  const spec: AdapterSpec<object, object> = {
    providerId: "recording",
    async call(_client, args) {
      provider(args);
      return { raw: {}, extracted: { ...toolCall(), text: "parent", toolCalls: undefined } };
    },
    async stream() { throw new Error("not used"); },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };
  const parent = agent({
    id: "parent",
    prompt: prompt({
      id: "parent-prompt",
      prompt: () => "parent",
      guardrails: [guardrail({
        id: "strip-child",
        on: boundary.input.tools(),
        run: () => ({ action: "strip", reason: "not exposed" }),
      })],
    }),
    tools: { child: child() },
  });

  await adapter(spec)({}).parallel({ id: "tool-guardrail", context: {}, agents: { parent }, model: "recording-model" });
  expect(provider).toHaveBeenCalledOnce();
  expect(provider.mock.calls[0]?.[0].tools ?? []).toEqual([]);
});
