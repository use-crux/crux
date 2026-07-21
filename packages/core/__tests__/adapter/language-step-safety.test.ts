/** Canonical language input and per-step Safety behavior. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adapter } from "../../src/adapter/define-adapter";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import type { AdapterSpec } from "../../src/adapter/spec";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import type { AdapterResponse } from "../../src/adapter/types";
import type { Message } from "../../src/generation/messages";
import { prompt } from "../../src/prompt/prompt";
import { boundary, guardrail } from "../../src/safety";

describe("language step Safety — exact input dispatch", () => {
  it("guards core user and model input independently before provider I/O", async () => {
    const seen: string[] = [];
    const calls: Array<{
      readonly messages: readonly Message[];
      readonly system: string | undefined;
      readonly systemBlocks: unknown;
    }> = [];
    const runtime = adapter(scriptedAdapter(calls))({
      kind: "language-input-test",
    });

    await runtime.generate(languagePrompt("language-input-core"), {
      model: "test-model",
      input: { message: "raw user" },
      guardrails: exactInputGuardrails(seen, "core"),
    });

    expect(seen).toEqual(["model.input.text:raw user", "model.instructions:raw system"]);
    expect(calls).toEqual([
      {
        messages: [{ role: "user", content: "guarded user" }],
        system: "guarded system",
        systemBlocks: undefined,
      },
    ]);
  });

  it("guards SDK user and model input independently before provider I/O", async () => {
    const seen: string[] = [];
    const fake = fakeLoopRuntime({ loops: [[{ text: "done" }]] });
    const runtime = loopRuntimeAdapter(fake.runtime);

    await runtime.generate(languagePrompt("language-input-sdk"), {
      model: "fake:test-model",
      input: { message: "raw user" },
      guardrails: exactInputGuardrails(seen, "sdk"),
    });

    expect(seen).toEqual(["model.input.text:raw user", "model.instructions:raw system"]);
    expect(fake.calls.runTextLoop[0]).toMatchObject({
      prompt: "guarded user",
      system: "guarded system",
      systemBlocks: undefined,
    });
  });

  it("guards core system-role messages at model input without exposing them to user input", async () => {
    const seen: string[] = [];
    const calls: Array<{
      readonly messages: readonly Message[];
      readonly system: string | undefined;
      readonly systemBlocks: unknown;
    }> = [];
    const runtime = adapter(scriptedAdapter(calls))({
      kind: "language-input-test",
    });

    await runtime.generate(
      languageMessagePrompt("language-message-input-core"),
      {
        model: "test-model",
        input: { message: "raw user" },
        guardrails: exactInputGuardrails(seen, "core-message"),
      },
    );

    expect(seen).toEqual(["model.input.text:raw user", "model.instructions:raw system"]);
    expect(calls[0]?.messages).toEqual([
      { role: "system", content: "guarded system" },
      { role: "user", content: "guarded user" },
    ]);
  });

  it("guards SDK system-role messages at model input without exposing them to user input", async () => {
    const seen: string[] = [];
    const fake = fakeLoopRuntime({ loops: [[{ text: "done" }]] });
    const runtime = loopRuntimeAdapter(fake.runtime);

    await runtime.generate(
      languageMessagePrompt("language-message-input-sdk"),
      {
        model: "fake:test-model",
        input: { message: "raw user" },
        guardrails: exactInputGuardrails(seen, "sdk-message"),
      },
    );

    expect(seen).toEqual(["model.input.text:raw user", "model.instructions:raw system"]);
    expect(fake.calls.runTextLoop[0]?.messages).toEqual([
      { role: "system", content: "guarded system" },
      { role: "user", content: "guarded user" },
    ]);
  });

  it("writes exact core stream input guards back before provider I/O", async () => {
    const seen: string[] = [];
    const calls: Array<{
      readonly messages: readonly Message[];
      readonly system: string | undefined;
      readonly systemBlocks: unknown;
    }> = [];
    const runtime = adapter(scriptedAdapter(calls))({
      kind: "language-input-test",
    });

    await runtime.stream(languagePrompt("language-stream-input-core"), {
      model: "test-model",
      input: { message: "raw user" },
      guardrails: exactInputGuardrails(seen, "core-stream"),
    });

    expect(seen).toEqual(["model.input.text:raw user", "model.instructions:raw system"]);
    expect(calls).toEqual([
      {
        messages: [{ role: "user", content: "guarded user" }],
        system: "guarded system",
        systemBlocks: undefined,
      },
    ]);
  });

  it("writes exact SDK stream input guards back before provider I/O", async () => {
    const seen: string[] = [];
    const fake = fakeLoopRuntime({ streams: [["done"]] });
    const runtime = loopRuntimeAdapter(fake.runtime);

    await runtime.stream(languagePrompt("language-stream-input-sdk"), {
      model: "fake:test-model",
      input: { message: "raw user" },
      guardrails: exactInputGuardrails(seen, "sdk-stream"),
    });

    expect(seen).toEqual(["model.input.text:raw user", "model.instructions:raw system"]);
    expect(fake.calls.runStream[0]).toMatchObject({
      prompt: "guarded user",
      system: "guarded system",
      systemBlocks: undefined,
    });
  });
});

describe("language step Safety — SDK transform capability", () => {
  it("rejects an applicable step guard before model I/O when the runtime cannot transform before client tools", async () => {
    const fake = fakeLoopRuntime({ loops: [[{ text: "must not run" }]] });
    const runtime = loopRuntimeAdapter(
      Object.assign({}, fake.runtime, { capabilities: undefined }),
    );

    await expect(
      runtime.generate(languagePrompt("language-step-capability"), {
        model: "fake:test-model",
        input: { message: "hello" },
        guardrails: [
          guardrail({
            id: "block-language-step",
            on: boundary.output.text(),
            run: () => ({ action: "block", reason: "unsafe" }),
          }),
        ],
      }),
    ).rejects.toThrow(/step transform/i);

    expect(fake.calls.runTextLoop).toHaveLength(0);
  });
});

function languagePrompt(id: string) {
  return prompt({
    id,
    system: "raw system",
    prompt: ({ input }) => input.message,
    input: z.object({ message: z.string() }),
  });
}

function languageMessagePrompt(id: string) {
  return prompt({
    id,
    messages: ({ input }) => [
      { role: "system" as const, content: "raw system" },
      { role: "user" as const, content: input.message },
    ],
    input: z.object({ message: z.string() }),
  });
}

function exactInputGuardrails(seen: string[], suffix: string) {
  return [
    guardrail({
      id: `guard-${suffix}-user`,
      on: boundary.input.text(),
      run: (text, context) => {
        seen.push(`${context.boundary.id}:${text}`);
        return {
          action: "rewrite" as const,
          value: "guarded user",
          rewrite: { kind: "normalize" as const },
        };
      },
    }),
    guardrail({
      id: `guard-${suffix}-model`,
      on: boundary.input.instructions(),
      run: (text, context) => {
        seen.push(`${context.boundary.id}:${text}`);
        return {
          action: "rewrite" as const,
          value: "guarded system",
          rewrite: { kind: "normalize" as const },
        };
      },
    }),
  ];
}

function scriptedAdapter(
  calls: Array<{
    readonly messages: readonly Message[];
    readonly system: string | undefined;
    readonly systemBlocks: unknown;
  }>,
): AdapterSpec<
  { readonly kind: "language-input-test" },
  { readonly ok: true },
  never
> {
  return {
    providerId: "language-input-test",
    async call(_client, args) {
      calls.push({
        messages: args.messages,
        system: args.system,
        systemBlocks: args.systemBlocks,
      });
      return { raw: { ok: true }, extracted: response("done") };
    },
    async stream(_client, args) {
      calls.push({
        messages: args.messages,
        system: args.system,
        systemBlocks: args.systemBlocks,
      });
      async function* rawStream() {
        yield { text: "done" };
      }
      return {
        rawStream: rawStream(),
        extractTextDelta: (chunk) =>
          (chunk as { readonly text?: string }).text,
        completion: async () => ({ finishReason: "stop" }),
      };
    },
    appendToolRound(messages) {
      return messages;
    },
    mapSettings(settings) {
      return { ...settings };
    },
  };
}

function response(text: string): AdapterResponse {
  return {
    text,
    usage: undefined,
    finishReason: "stop",
    responseId: undefined,
    actualModelId: undefined,
  };
}
