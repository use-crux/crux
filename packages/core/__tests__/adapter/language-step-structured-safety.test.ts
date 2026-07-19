/** Structured language output uses one step pass plus terminal-only policy. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import { prompt } from "../../src/prompt/prompt";
import { boundary, guardrail } from "../../src/safety";

const structuredPrompt = prompt({
  id: "language-step-structured",
  prompt: ({ input }) => input.message,
  input: z.object({ message: z.string() }),
  output: z.object({ value: z.string() }),
});

describe("language step Safety — structured output", () => {
  it("guards provider text before parsing, then runs terminal both guards without double application", async () => {
    const textSeen: string[] = [];
    const terminalSeen: string[] = [];
    const fake = fakeLoopRuntime({
      structured: ['{"value":"unsafe"}'],
    });

    const result = await loopRuntimeAdapter(fake.runtime).generate(
      structuredPrompt,
      {
        model: "fake:test-model",
        input: { message: "return JSON" },
        guardrails: [
          guardrail({
            id: "rewrite-structured-step",
            on: boundary.output.text(),
            run: (text) => {
              textSeen.push(text);
              return {
                action: "rewrite",
                value: text.replace("unsafe", "safe"),
                rewrite: { kind: "normalize" },
              };
            },
          }),
          guardrail({
            id: "inspect-structured-terminal",
            on: boundary.output.both<{ value: string }>(),
            run: (output) => {
              terminalSeen.push(output.text);
              return { action: "allow" };
            },
          }),
        ],
      },
    );

    expect(textSeen).toEqual(['{"value":"unsafe"}']);
    expect(terminalSeen).toEqual(['{"value":"safe"}']);
    expect(result.text).toBe('{"value":"safe"}');
    expect(result.object).toEqual({ value: "safe" });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.text).toBe('{"value":"safe"}');
    expect(result.finalStep).toBe(result.steps[0]);
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: '{"value":"safe"}',
    });
  });

  it("writes a terminal object rewrite back to text, object, step, and message without touching raw", async () => {
    const textSeen: string[] = [];
    const objectSeen: unknown[] = [];
    const bothSeen: unknown[] = [];
    const fake = fakeLoopRuntime({ structured: ['{"value":"initial"}'] });

    const result = await loopRuntimeAdapter(fake.runtime).generate(
      structuredPrompt,
      {
        model: "fake:test-model",
        input: { message: "return JSON" },
        guardrails: [
          guardrail({
            id: "observe-structured-step",
            on: boundary.output.text(),
            run: (text) => {
              textSeen.push(text);
              return { action: "allow" };
            },
          }),
          guardrail({
            id: "rewrite-structured-object",
            on: boundary.output.object<{ value: string }>(),
            run: (object) => {
              objectSeen.push(object);
              return {
                action: "rewrite",
                value: { value: "terminal" },
                rewrite: { kind: "normalize" },
              };
            },
          }),
          guardrail({
            id: "inspect-rewritten-structured-both",
            on: boundary.output.both<{ value: string }>(),
            run: (output) => {
              bothSeen.push(output);
              return { action: "allow" };
            },
          }),
        ],
      },
    );

    expect(textSeen).toEqual(['{"value":"initial"}']);
    expect(objectSeen).toEqual([{ value: "initial" }]);
    expect(bothSeen).toEqual([
      { text: '{"value":"terminal"}', object: { value: "terminal" } },
    ]);
    expect(result.raw.text).toBe('{"value":"initial"}');
    expect(result.text).toBe('{"value":"terminal"}');
    expect(result.object).toEqual({ value: "terminal" });
    expect(result.steps).toHaveLength(1);
    expect(result.finalStep.text).toBe('{"value":"terminal"}');
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: '{"value":"terminal"}',
    });
  });

  it("rewrites an object path immutably before a downstream both guard", async () => {
    const original = { profile: { label: "initial", count: 1 } };
    const nestedPrompt = prompt({
      id: "language-step-structured-path",
      prompt: "return JSON",
      output: z.object({
        profile: z.object({ label: z.string(), count: z.number() }),
      }),
    });
    const pathSeen: unknown[] = [];
    const bothSeen: unknown[] = [];
    const fake = fakeLoopRuntime({ structured: [JSON.stringify(original)] });

    const result = await loopRuntimeAdapter(fake.runtime).generate(
      nestedPrompt,
      {
        model: "fake:test-model",
        guardrails: [
          guardrail({
            id: "rewrite-structured-path",
            on: boundary.output
              .path<typeof original>()("profile.label"),
            run: (label) => {
              pathSeen.push(label);
              return {
                action: "rewrite",
                value: "terminal",
                rewrite: { kind: "normalize" },
              };
            },
          }),
          guardrail({
            id: "inspect-path-rewrite-both",
            on: boundary.output.both<typeof original>(),
            run: (output) => {
              bothSeen.push(output);
              return { action: "allow" };
            },
          }),
        ],
      },
    );

    expect(pathSeen).toEqual(["initial"]);
    expect(original).toEqual({ profile: { label: "initial", count: 1 } });
    expect(bothSeen).toEqual([
      {
        text: '{"profile":{"label":"terminal","count":1}}',
        object: { profile: { label: "terminal", count: 1 } },
      },
    ]);
    expect(result.object).toEqual({
      profile: { label: "terminal", count: 1 },
    });
    expect(result.finalStep.text).toBe(
      '{"profile":{"label":"terminal","count":1}}',
    );
  });

  it("guards each structured validation attempt before retaining its step", async () => {
    const seen: string[] = [];
    const fake = fakeLoopRuntime({
      structured: ['{"value":1}', '{"value":"unsafe"}'],
    });

    const result = await loopRuntimeAdapter(fake.runtime).generate(
      structuredPrompt,
      {
        model: "fake:test-model",
        input: { message: "return JSON" },
        validationRetry: { maxRetries: 1 },
        guardrails: [
          guardrail({
            id: "guard-structured-validation-attempts",
            on: boundary.output.text(),
            run: (text) => {
              seen.push(text);
              return text.includes("unsafe")
                ? {
                    action: "rewrite",
                    value: text.replace("unsafe", "safe"),
                    rewrite: { kind: "normalize" },
                  }
                : { action: "allow" };
            },
          }),
        ],
      },
    );

    expect(seen).toEqual(['{"value":1}', '{"value":"unsafe"}']);
    expect(result.steps.map((step) => step.text)).toEqual([
      "",
      '{"value":"safe"}',
    ]);
    expect(result.object).toEqual({ value: "safe" });
  });
});
