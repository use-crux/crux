/**
 * Guarded rejected-output parity across both public provider-runtime branches.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineProviderRuntime } from "../../src/adapter";
import {
  fakeLoopRuntime,
  type FakeLoopRuntime,
} from "../../src/adapter/testing";
import type { Message } from "../../src/generation/messages";
import { prompt } from "../../src/prompt/prompt";
import { boundary, guardrail } from "../../src/safety";
import { replaceFinalAssistantOutput } from "../../src/adapter/execution/messages";
import {
  createRuntimeClient,
  createSingleTurnTestRuntime,
  runtimeResponse,
  type RuntimeProviderMessage,
} from "./provider-runtime-fixtures";

const REJECTED = '{"title":"hi","count":"two"}';
const GUARDED = '{"title":"guarded","count":"two"}';
const ACCEPTED = '{"title":"hi","count":2}';

describe("provider-runtime guarded retry transcript", () => {
  it("writes the rewritten rejected output identically through both branches", async () => {
    const policy = guardrail({
      id: "rewrite-rejected-output",
      on: boundary.input.text({ from: "feedback" }),
      run: (text, context) =>
        context.origin.kind === "rejected-output"
          ? {
              action: "rewrite",
              value: text.replace('"title":"hi"', '"title":"guarded"'),
              rewrite: { kind: "normalize" },
            }
          : { action: "allow" },
    });
    const singleClient = createRuntimeClient({
      responses: [runtimeResponse(REJECTED), runtimeResponse(ACCEPTED)],
    });
    await createSingleTurnTestRuntime()
      .create(singleClient)
      .generate(structuredPrompt(), {
        model: "mock-model",
        input: { message: "make json" },
        validationRetry: { maxRetries: 1 },
        guardrails: [policy],
      });

    const fake = fakeLoopRuntime({ structured: [REJECTED, ACCEPTED] });
    await createLoopRuntime(fake).generate(structuredPrompt(), {
      model: "fake:mock-model",
      input: { message: "make json" },
      validationRetry: { maxRetries: 1 },
      guardrails: [policy],
    });

    expect(lastProviderAssistant(singleClient.calls[1]!.messages)).toBe(
      GUARDED,
    );
    expect(
      lastAssistant(fake.calls.runStructuredAttempt[1]!.messages ?? []),
    ).toBe(GUARDED);
  });

  it("preserves rich assistant parts and tool-call facts when text is guarded", () => {
    const toolCall = {
      id: "call_1",
      name: "lookup",
      args: { id: 1 },
    };
    const original: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "retain reasoning" },
          { type: "text", text: REJECTED },
          {
            type: "tool-call",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            input: toolCall.args,
          },
        ],
        metadata: { toolCalls: [toolCall], stable: true },
      },
    ];

    const rewritten = replaceFinalAssistantOutput(original, GUARDED);

    expect(rewritten).toEqual([
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "retain reasoning" },
          { type: "text", text: GUARDED },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "lookup",
            input: { id: 1 },
          },
        ],
        metadata: { toolCalls: [toolCall], stable: true },
      },
    ]);
    expect(original[0]?.content).not.toEqual(rewritten[0]?.content);
  });
});

function structuredPrompt() {
  return prompt({
    id: "provider-runtime-retry-transcript",
    prompt: ({ input }) => input.message,
    input: z.object({ message: z.string() }),
    output: z.object({ title: z.string(), count: z.number() }),
  });
}

function createLoopRuntime(fake: FakeLoopRuntime) {
  return defineProviderRuntime({
    id: "provider-runtime-retry-transcript-loop",
    loop: {
      describeModel: fake.runtime.describeModel,
      settings: fake.runtime.mapSettings,
      structuredOutput: fake.runtime.structuredOutput,
      bind: () => ({
        capabilities: fake.runtime.capabilities,
        runTextLoop: fake.runtime.runTextLoop,
        runStructuredAttempt: fake.runtime.runStructuredAttempt,
        runStream: fake.runtime.runStream,
      }),
    },
  }).create({});
}

function lastProviderAssistant(
  messages: readonly RuntimeProviderMessage[],
): RuntimeProviderMessage["text"] | undefined {
  return [...messages].reverse().find((message) => message.role === "assistant")
    ?.text;
}

function lastAssistant(
  messages: readonly Message[],
): Message["content"] | undefined {
  return [...messages].reverse().find((message) => message.role === "assistant")
    ?.content;
}
