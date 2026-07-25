/**
 * Coordinated SDK stream (RFC #173, Phase 15, Fork A) — real AI SDK v6.
 *
 * Core owns retry policy (commit gates, budget, typed terminal errors); this package
 * owns how attempts are physically streamed and composed. A rejected attempt is
 * discarded and restreamed, reaching no user-facing channel; only the accepted attempt's
 * bytes, completion, and object are published.
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt } from "@use-crux/core";
import { boundary } from "@use-crux/core/safety";
import { constraint } from "@use-crux/core/safety";
import { ConstraintViolationError } from "@use-crux/core/safety";
import { createCruxAi, toUIMessageStream } from "../src";
import { capturingStreamingEmissionModel } from "./mock-model";

const structured = prompt({
  id: "coordinated-stream",
  prompt: "return json",
  output: z.object({ title: z.string(), count: z.number() }),
});

async function drainText(handle: {
  readonly textStream: AsyncIterable<string>;
}): Promise<string> {
  let text = "";
  for await (const chunk of handle.textStream) text += chunk;
  return text;
}

describe("coordinated SDK stream", () => {
  it("retries a rejected assert attempt and publishes only the accepted stream", async () => {
    const countPositive = constraint({
      id: "count-positive",
      on: boundary.output.object<{ title: string; count: number }>(),
      run: (obj: { title: string; count: number }) =>
        obj.count > 0 ? { pass: true } : { pass: false, feedback: "count must be positive" },
    });
    const { model, prompts } = capturingStreamingEmissionModel([
      { text: '{"title":"a","count":-1}' }, // rejected
      { text: '{"title":"a","count":2}' }, // accepted
    ]);

    const handle = await createCruxAi().stream(structured, {
      model,
      constraints: [countPositive],
    });
    const text = await drainText(handle);
    const completion = await handle.completion;

    // Only the accepted attempt's bytes reached the consumer.
    expect(text).toBe('{"title":"a","count":2}');
    expect(completion.object).toEqual({ title: "a", count: 2 });
    // Two physical provider calls; the retry carried corrective feedback.
    expect(prompts).toHaveLength(2);
    expect(JSON.stringify(prompts[1])).toContain("count must be positive");
  });

  it("throws ConstraintViolationError when retries are exhausted, leaking no bytes", async () => {
    const impossible = constraint({
      id: "impossible",
      maxRetries: 1,
      on: boundary.output.object<{ title: string; count: number }>(),
      run: () => ({ pass: false as const, feedback: "never passes" }),
    });
    const { model } = capturingStreamingEmissionModel([
      { text: '{"title":"a","count":1}' },
      { text: '{"title":"a","count":2}' },
      { text: '{"title":"a","count":3}' },
    ]);
    const handle = await createCruxAi().stream(structured, {
      model,
      constraints: [impossible],
    });
    let seen = "";
    let thrown: unknown;
    try {
      for await (const chunk of handle.textStream) seen += chunk;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConstraintViolationError);
    expect(seen).toBe(""); // a discarded attempt publishes nothing
  });

  it("keeps the untouched single-attempt path when no commit gate is active", async () => {
    const { model, prompts } = capturingStreamingEmissionModel([
      { text: '{"title":"a","count":1}' },
    ]);
    const handle = await createCruxAi().stream(structured, { model });
    const text = await drainText(handle);
    const completion = await handle.completion;
    expect(text).toBe('{"title":"a","count":1}');
    expect(completion.object).toEqual({ title: "a", count: 1 });
    expect(prompts).toHaveLength(1);
  });

  it("does not re-run an accepted stream assert at completion (settlement suppression)", async () => {
    const run = vi.fn((obj: { title: string; count: number }) =>
      obj.count > 0
        ? ({ pass: true } as const)
        : ({ pass: false, feedback: "positive" } as const),
    );
    const once = constraint({
      id: "count-once",
      on: boundary.output.object<{ title: string; count: number }>(),
      run,
    });
    const { model } = capturingStreamingEmissionModel([{ text: '{"title":"a","count":2}' }]);
    const handle = await createCruxAi().stream(structured, {
      model,
      constraints: [once],
    });
    await drainText(handle);
    await handle.completion;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("matches the native route: same published text and object across a retry", async () => {
    const countPositive = constraint({
      id: "count-positive",
      on: boundary.output.object<{ title: string; count: number }>(),
      run: (obj: { title: string; count: number }) =>
        obj.count > 0 ? { pass: true } : { pass: false, feedback: "positive" },
    });
    const { model } = capturingStreamingEmissionModel([
      { text: '{"title":"parity","count":-5}' },
      { text: '{"title":"parity","count":7}' },
    ]);
    const handle = await createCruxAi().stream(structured, {
      model,
      constraints: [countPositive],
    });
    const text = await drainText(handle);
    const completion = await handle.completion;
    // Identical published semantics to the native coordinated route.
    expect(text).toBe('{"title":"parity","count":7}');
    expect(completion.object).toEqual({ title: "parity", count: 7 });
  });
});

// A coordinated stream exposes several logical surfaces over one composed part sequence.
// They must be independent, simultaneously readable, abandonable, and never leak a
// discarded attempt's non-text parts — which the safety transform does not gate.
describe("coordinated SDK stream lifecycle", () => {
  const countPositive = constraint({
    id: "count-positive",
    on: boundary.output.object<{ title: string; count: number }>(),
    run: (obj: { title: string; count: number }) =>
      obj.count > 0 ? { pass: true } : { pass: false, feedback: "count must be positive" },
  });

  const twoAttempts = () =>
    capturingStreamingEmissionModel([
      {
        // A reasoning part is NOT gated by the safety transform, so a discarded attempt
        // must not be able to publish it.
        content: [
          { type: "reasoning", text: "discarded-reasoning-secret" },
          { type: "text", text: '{"title":"a","count":-1}' },
        ] as never,
      },
      { text: '{"title":"a","count":2}' },
    ]);

  it("resolves completion without the caller draining any surface", async () => {
    const { model } = twoAttempts();
    const handle = await createCruxAi().stream(structured, {
      model,
      constraints: [countPositive],
    });
    // No surface is consumed at all.
    const completion = await Promise.race([
      handle.completion,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("completion deadlocked")), 5000),
      ),
    ]);
    expect((completion as { object?: unknown }).object).toEqual({ title: "a", count: 2 });
  });

  it("serves fullStream and textStream simultaneously without stealing parts", async () => {
    const { model } = twoAttempts();
    const handle = await createCruxAi().stream(structured, {
      model,
      constraints: [countPositive],
    });
    const [text, parts] = await Promise.all([
      (async () => {
        let seen = "";
        for await (const chunk of handle.textStream) seen += chunk;
        return seen;
      })(),
      (async () => {
        const seen: unknown[] = [];
        for await (const event of handle.fullStream) seen.push(event);
        return seen;
      })(),
    ]);
    // Neither surface starved the other.
    expect(text).toBe('{"title":"a","count":2}');
    expect(parts.length).toBeGreaterThan(0);
  });

  it("serves a full-stream-only consumer", async () => {
    const { model } = twoAttempts();
    const handle = await createCruxAi().stream(structured, {
      model,
      constraints: [countPositive],
    });
    const parts: unknown[] = [];
    for await (const event of handle.fullStream) parts.push(event);
    expect(parts.length).toBeGreaterThan(0);
    // The accepted attempt's text reached the full-stream surface.
    const textParts = parts
      .filter((part) => (part as { type?: string }).type === "text-delta")
      .map((part) => (part as { text?: string }).text ?? "")
      .join("");
    expect(textParts).toBe('{"title":"a","count":2}');
  });

  it("never publishes a discarded attempt's non-text parts on any surface", async () => {
    const { model } = twoAttempts();
    const handle = await createCruxAi().stream(structured, {
      model,
      constraints: [countPositive],
    });
    const parts: unknown[] = [];
    for await (const event of handle.fullStream) parts.push(event);
    await handle.completion;
    // Reasoning is not gated by the safety transform, so it must be held behind the
    // commit gate; the discarded attempt's reasoning must never surface.
    expect(JSON.stringify(parts)).not.toContain("discarded-reasoning-secret");
  });

  it("lets a consumer stop early without stalling completion", async () => {
    const { model } = twoAttempts();
    const handle = await createCruxAi().stream(structured, {
      model,
      constraints: [countPositive],
    });
    for await (const _chunk of handle.textStream) break; // abandon after one part
    const completion = await Promise.race([
      handle.completion,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("completion stalled after early return")), 5000),
      ),
    ]);
    expect((completion as { object?: unknown }).object).toEqual({ title: "a", count: 2 });
  });

  it("does not raise an unhandled rejection when only one surface is consumed", async () => {
    const impossible = constraint({
      id: "impossible-lifecycle",
      maxRetries: 1,
      on: boundary.output.object<{ title: string; count: number }>(),
      run: () => ({ pass: false as const, feedback: "never passes" }),
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const { model } = capturingStreamingEmissionModel([
        { text: '{"title":"a","count":1}' },
        { text: '{"title":"a","count":2}' },
        { text: '{"title":"a","count":3}' },
      ]);
      const handle = await createCruxAi().stream(structured, {
        model,
        constraints: [impossible],
      });
      // Consume ONLY the text surface; `completion` is never awaited.
      await expect(drainText(handle)).rejects.toBeInstanceOf(ConstraintViolationError);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });
});

// A validation-gated SDK attempt buffered its parts but never validated them: the
// candidate was accepted and published, and only the outer completion threw — after the
// bytes had escaped and with no retry. Core now owns the authoritative parse.
describe("coordinated SDK validation gate", () => {
  const positiveCount = z.object({
    title: z.string(),
    count: z.number().refine((n) => n > 0, "count must be positive"),
  });
  const refined = prompt({
    id: "coordinated-validation",
    prompt: "return json",
    output: positiveCount,
  });

  it("retries an invalid candidate and publishes only the valid one", async () => {
    const { model, prompts } = capturingStreamingEmissionModel([
      { text: '{"title":"a","count":-1}' }, // wire-valid, schema-invalid
      { text: '{"title":"a","count":2}' },
    ]);
    const handle = await createCruxAi().stream(refined, {
      model,
      validationRetry: { maxRetries: 1 },
    });
    const text = await drainText(handle);
    const completion = await handle.completion;

    expect(text).toBe('{"title":"a","count":2}');
    expect(completion.object).toEqual({ title: "a", count: 2 });
    expect(prompts).toHaveLength(2); // the invalid attempt was retried, not published
  });

  it("publishes nothing when validation retries are exhausted", async () => {
    const { model } = capturingStreamingEmissionModel([
      { text: '{"title":"a","count":-1}' },
      { text: '{"title":"a","count":-2}' },
    ]);
    const handle = await createCruxAi().stream(refined, {
      model,
      validationRetry: { maxRetries: 1 },
    });
    let seen = "";
    let thrown: unknown;
    try {
      for await (const chunk of handle.textStream) seen += chunk;
    } catch (error) {
      thrown = error;
    }
    expect(seen).toBe("");
    expect(thrown).toBeDefined();
  });
});

// The coordinated composite must keep the AI SDK result contract the README and JSDoc
// promise — real stream types, the UI-message integration, and the completion getters —
// rather than narrowing it to whatever the retry machinery happened to need.
describe("coordinated SDK stream preserves the documented surface", () => {
  const countPositive = constraint({
    id: "count-positive",
    on: boundary.output.object<{ title: string; count: number }>(),
    run: (obj: { title: string; count: number }) =>
      obj.count > 0 ? { pass: true } : { pass: false, feedback: "count must be positive" },
  });

  const twoAttempts = () =>
    capturingStreamingEmissionModel([
      { text: '{"title":"a","count":-1}' },
      { text: '{"title":"a","count":2}' },
    ]);

  it("exposes genuine ReadableStream surfaces, not bare async generators", async () => {
    const { model } = twoAttempts();
    const handle = await createCruxAi().stream(structured, {
      model,
      constraints: [countPositive],
    });
    const surfaces = handle as unknown as Record<string, unknown>;
    for (const key of ["fullStream", "textStream", "partialOutputStream"]) {
      expect(surfaces[key]).toBeInstanceOf(ReadableStream);
      expect(
        typeof (surfaces[key] as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator],
      ).toBe("function");
    }
  });

  it("resolves the completion envelope from the accepted attempt", async () => {
    const { model } = twoAttempts();
    const handle = await createCruxAi().stream(structured, {
      model,
      constraints: [countPositive],
    });
    await drainText(handle);
    // Every terminal fact comes from the ONE completion envelope: there is no
    // provider result to read them off, so the accepted attempt is the only
    // thing they can describe.
    const completion = await handle.completion;

    expect(completion.text).toBe('{"title":"a","count":2}');
    expect(completion.object).toEqual({ title: "a", count: 2 });
    expect(completion.finalStep.finishReason).toBeDefined();
    // The final STEP still reports what the accepted attempt used…
    expect(completion.finalStep.usage).toBeDefined();
    // …but the logical total is omitted, because this operation also paid for a
    // discarded attempt whose usage the SDK never reported: its parts stop at
    // `text-end` when the Safety transform rejects. Omitting beats reporting the
    // accepted attempt's figures as if they were the whole bill (RFC #173, law 7).
    expect(completion.usage).toBeUndefined();
  });

  it("supports the documented UI-message integration", async () => {
    const { model } = twoAttempts();
    const handle = await createCruxAi().stream(structured, {
      model,
      constraints: [countPositive],
    });
    const uiStream = toUIMessageStream(handle);
    expect(uiStream).toBeInstanceOf(ReadableStream);

    // It must actually produce UI-message chunks for the accepted attempt.
    const reader = uiStream.getReader();
    const chunks: unknown[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
    expect(chunks.length).toBeGreaterThan(0);
    // The discarded attempt never reaches a `useChat` transport.
    expect(JSON.stringify(chunks)).not.toContain('"count":-1');
  });
});

// Two invariants the coordinated route claims but had silently lost.
describe("coordinated SDK route parity invariants", () => {
  const mustCite = constraint({
    id: "must-cite",
    on: boundary.output.text(),
    run: (text: string) =>
      text.includes("[1]") ? { pass: true } : { pass: false, feedback: "cite a source" },
  });
  const textPrompt = prompt({ id: "parity-text", prompt: "answer" });

  it("forwards committed text before EOF (early unlock, matching the native route)", async () => {
    const { model } = capturingStreamingEmissionModel([{ text: "answered [1]" }]);
    const handle = await createCruxAi().stream(textPrompt, {
      model,
      constraints: [mustCite],
    });

    // Structural framing precedes the first text delta. If those parts were treated as
    // "held", nothing could ever be forwarded early and this would only settle at EOF.
    let sawTextBeforeFinish = false;
    for await (const part of handle.fullStream) {
      const type = (part as { type?: string }).type;
      if (type === "text-delta") sawTextBeforeFinish = true;
      if (type === "finish") break;
    }
    expect(sawTextBeforeFinish).toBe(true);
  });

  it("still honours timeout.stepMs on a coordinated stream", async () => {
    // A model that never produces output: only the step budget can end this.
    const stalling = capturingStreamingEmissionModel([]).model;
    const handle = await createCruxAi().stream(textPrompt, {
      model: stalling,
      constraints: [mustCite],
      timeout: { stepMs: 50 },
    });
    // Whatever the outcome, it must SETTLE rather than hang: the attempt's abort signal
    // composes the step budget instead of replacing it.
    await expect(
      Promise.race([
        drainText(handle).catch(() => "settled"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("step budget never applied")), 4000),
        ),
      ]),
    ).resolves.toBeDefined();
  });
});
