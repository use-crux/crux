/**
 * Caller callbacks are LOGICAL (RFC #173, contract 06).
 *
 * No caller callback is installed on a physical provider attempt. They observe
 * the published sequence and the logical completion only, which is what makes
 * "a discarded attempt invokes none" true by construction rather than by a
 * filter someone has to remember. A callback exception is diagnostic: it cannot
 * become the operation's outcome, error a surface, or change `completion`.
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt } from "@use-crux/core";
import { boundary, constraint } from "@use-crux/core/safety";
import type { StreamEvent } from "@use-crux/core/adapter";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModel } from "ai";
import { createCruxAi } from "../src";
import { capturingStreamingEmissionModel } from "./mock-model";

/** A model whose stream fails mid-flight, so the operation genuinely rejects. */
function failingModel(error: Error): LanguageModel {
  return new MockLanguageModelV3({
    provider: "openai",
    modelId: "gpt-4o",
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.error(error);
        },
      }),
    }),
  }) as unknown as LanguageModel;
}

const textOnly = prompt({ id: "callbacks-text", prompt: "answer" });
const structured = prompt({
  id: "callbacks-structured",
  prompt: "return json",
  output: z.object({ title: z.string(), count: z.number() }),
});

const countPositive = constraint({
  id: "count-positive",
  on: boundary.output.object<{ title: string; count: number }>(),
  run: (value: { title: string; count: number }) =>
    value.count > 0
      ? { pass: true }
      : { pass: false, feedback: "count must be positive" },
});

/** Every type the closed logical vocabulary defines. */
const LOGICAL_TYPES = new Set([
  "start",
  "text-delta",
  "reasoning-delta",
  "media",
  "tool-call",
  "tool-result",
  "tool-approval-request",
  "source",
  "partial-output",
  "finish",
]);

async function drain(result: { textStream: AsyncIterable<string> }) {
  let text = "";
  for await (const delta of result.textStream) text += delta;
  return text;
}

describe("logical callbacks — ordinary route", () => {
  it("delivers published logical events, never provider part shapes", async () => {
    const seen: StreamEvent<unknown>[] = [];
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel([{ text: "answered" }]).model,
      onChunk: (event) => {
        seen.push(event);
      },
    });
    await drain(result);
    await result.completion;

    expect(seen.length).toBeGreaterThan(0);
    for (const event of seen) expect(LOGICAL_TYPES.has(event.type)).toBe(true);
    // The physical protocol stops at the seam: no step framing, no block
    // boundaries, no `raw` passthrough reaches a caller callback.
    expect(seen.map((event) => event.type)).not.toContain("start-step");
    expect(seen.map((event) => event.type)).not.toContain("text-start");
    // And the caller sees the operation's framing exactly once.
    expect(seen.filter((event) => event.type === "start")).toHaveLength(1);
    expect(seen.filter((event) => event.type === "finish")).toHaveLength(1);
  });

  it("invokes onFinish once with the logical completion and never onError", async () => {
    const onFinish = vi.fn();
    const onError = vi.fn();
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel([{ text: "answered" }]).model,
      onFinish,
      onError,
    });
    const completion = await result.completion;

    expect(onFinish).toHaveBeenCalledTimes(1);
    // The SAME envelope the caller awaits — not a provider finish event.
    expect(onFinish.mock.calls[0]?.[0]).toBe(completion);
    expect(onError).not.toHaveBeenCalled();
  });

  it("invokes onError once on a terminal failure and never onFinish", async () => {
    const onFinish = vi.fn();
    const onError = vi.fn();
    const result = await createCruxAi().stream(textOnly, {
      model: failingModel(new Error("provider exploded")),
      onFinish,
      onError,
    });

    await result.completion.catch(() => undefined);
    await drain(result).catch(() => undefined);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("treats a callback exception as diagnostic only", async () => {
    const onFinish = vi.fn();
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel([{ text: "answered" }]).model,
      onChunk: () => {
        throw new Error("callback bug");
      },
      onFinish,
    });

    // The stream and completion are unaffected, and the terminal callback still
    // runs — a broken observer must not become the operation's outcome.
    expect(await drain(result)).toBe("answered");
    await expect(result.completion).resolves.toBeDefined();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});

describe("logical callbacks — coordinated route", () => {
  const twoAttempts = () =>
    capturingStreamingEmissionModel([
      { text: '{"title":"a","count":-1}' },
      { text: '{"title":"a","count":2}' },
    ]);

  it("delivers nothing from a discarded attempt", async () => {
    const seen: StreamEvent<unknown>[] = [];
    const result = await createCruxAi().stream(structured, {
      model: twoAttempts().model,
      constraints: [countPositive],
      onChunk: (event) => {
        seen.push(event);
      },
    });
    await drain(result);
    await result.completion;

    // The rejected candidate never reaches an observer, in any event.
    expect(JSON.stringify(seen)).not.toContain('"count":-1');
    const text = seen
      .filter(
        (event): event is Extract<StreamEvent<unknown>, { type: "text-delta" }> =>
          event.type === "text-delta",
      )
      .map((event) => event.text)
      .join("");
    expect(text).toBe('{"title":"a","count":2}');
  });

  it("does not invoke onError for a retry that ultimately succeeds", async () => {
    const onError = vi.fn();
    const onFinish = vi.fn();
    const result = await createCruxAi().stream(structured, {
      model: twoAttempts().model,
      constraints: [countPositive],
      onError,
      onFinish,
    });
    await drain(result);
    await result.completion;

    // A discarded attempt is a policy decision, not the operation's outcome.
    expect(onError).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("emits one logical frame across the retry", async () => {
    const seen: StreamEvent<unknown>[] = [];
    const result = await createCruxAi().stream(structured, {
      model: twoAttempts().model,
      constraints: [countPositive],
      onChunk: (event) => {
        seen.push(event);
      },
    });
    await drain(result);
    await result.completion;

    expect(seen.filter((event) => event.type === "start")).toHaveLength(1);
    expect(seen.filter((event) => event.type === "finish")).toHaveLength(1);
  });
});
