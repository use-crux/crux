/**
 * The managed logical stream contract, end to end (RFC #173, contract 06).
 *
 * These exercise the PUBLIC result through the real AI SDK route, so they pin the
 * properties a caller can rely on rather than the internals that implement them:
 * one result shape regardless of Safety gates, canonical structured text that
 * agrees with the partial projection and the validated object, one logical frame
 * per operation, and cancellation that reaches every surface.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { prompt } from "@use-crux/core";
import { boundary, constraint, guardrail } from "@use-crux/core/safety";
import type { StreamEvent } from "@use-crux/core/adapter";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModel } from "ai";
import { createCruxAi, toUIMessageStream } from "../src";
import { capturingStreamingEmissionModel } from "./mock-model";

/**
 * A model that hands back its abort signal and streams one delta, then stalls.
 *
 * Cancellation must reach the PROVIDER, not merely detach readers, so the test
 * needs something that can report whether the physical attempt was aborted.
 */
function stallingModel(): {
  readonly model: LanguageModel;
  signal: () => AbortSignal | undefined;
} {
  let captured: AbortSignal | undefined;
  const model = new MockLanguageModelV3({
    provider: "openai",
    modelId: "gpt-4o",
    doStream: async (options: { abortSignal?: AbortSignal }) => {
      captured = options.abortSignal;
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "t1" });
            controller.enqueue({ type: "text-delta", id: "t1", delta: "partial" });
            // Deliberately never closed: only cancellation can end this.
          },
        }),
      };
    },
  }) as unknown as LanguageModel;
  return { model, signal: () => captured };
}

const structured = prompt({
  id: "logical-structured",
  prompt: "return json",
  output: z.object({ title: z.string(), count: z.number() }),
});
const textOnly = prompt({ id: "logical-text", prompt: "answer" });

const countPositive = constraint({
  id: "count-positive",
  on: boundary.output.object<{ title: string; count: number }>(),
  run: (value: { title: string; count: number }) =>
    value.count > 0 ? { pass: true } : { pass: false, feedback: "count must be positive" },
});

const RESULT_KEYS = [
  "_meta",
  "cancel",
  "completion",
  "fullStream",
  "partialOutputStream",
  "runId",
  "textStream",
];

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

describe("managed logical stream — result shape", () => {
  it("has the same key set with no gates, an assert gate, and a validation-retry gate", async () => {
    const plain = await createCruxAi().stream(structured, {
      model: capturingStreamingEmissionModel([
        { text: '{"title":"a","count":2}' },
      ]).model,
    });
    const asserted = await createCruxAi().stream(structured, {
      model: capturingStreamingEmissionModel([
        { text: '{"title":"a","count":-1}' },
        { text: '{"title":"a","count":2}' },
      ]).model,
      constraints: [countPositive],
    });
    const validating = await createCruxAi().stream(structured, {
      model: capturingStreamingEmissionModel([
        { text: '{"title":"a","count":2}' },
      ]).model,
      validationRetry: { maxRetries: 1 },
    });

    for (const result of [plain, asserted, validating]) {
      expect(Object.keys(result).sort()).toEqual(RESULT_KEYS);
      expect("raw" in result).toBe(false);
    }
    // …and the behaviour matches too, not merely the shape. The EXACT canonical
    // text must be identical across all three: "some string was published"
    // cannot tell canonical `z.input` apart from provider wire JSON, which is
    // precisely what a gate is allowed to change.
    for (const result of [plain, asserted, validating]) {
      const text = (await collect(result.textStream)).join("");
      expect(text).toBe('{"title":"a","count":2}');
      expect((await result.completion).object).toEqual({
        title: "a",
        count: 2,
      });
    }
  });

  it("keeps the same key set for a text prompt and closes its partial surface empty", async () => {
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel([{ text: "answered" }]).model,
    });

    expect(Object.keys(result).sort()).toEqual(RESULT_KEYS);
    // The surface exists unconditionally so the result stays discoverable; it
    // simply carries no values for a prompt with no authored schema.
    expect(await collect(result.partialOutputStream)).toEqual([]);
    expect((await result.completion).text).toBe("answered");
  });
});

describe("managed logical stream — structured projection", () => {
  it("publishes canonical text that agrees with the partials and the validated object", async () => {
    const result = await createCruxAi().stream(structured, {
      model: capturingStreamingEmissionModel([
        { text: '{"title":"a","count":2}' },
      ]).model,
    });

    const [text, partials] = await Promise.all([
      collect(result.textStream).then((chunks) => chunks.join("")),
      collect(result.partialOutputStream),
    ]);
    const completion = await result.completion;

    // The text is canonical `z.input` JSON, never provider wire JSON.
    expect(text).toBe('{"title":"a","count":2}');
    // Every partial is a prefix-consistent projection of that same text, and the
    // last one describes the whole published value.
    expect(partials.length).toBeGreaterThan(0);
    expect(partials.at(-1)).toEqual({ title: "a", count: 2 });
    expect(JSON.parse(text)).toEqual(partials.at(-1));
    // `object` is the authored schema's validated output.
    expect(completion.object).toEqual({ title: "a", count: 2 });
  });

  it("publishes no partial from a rejected attempt", async () => {
    const result = await createCruxAi().stream(structured, {
      model: capturingStreamingEmissionModel([
        { text: '{"title":"a","count":-1}' },
        { text: '{"title":"a","count":2}' },
      ]).model,
      constraints: [countPositive],
    });

    const partials = await collect(result.partialOutputStream);
    await result.completion;

    // The discarded attempt's value never appears, not even transiently.
    expect(partials).not.toContainEqual(
      expect.objectContaining({ count: -1 }),
    );
    expect(partials.at(-1)).toEqual({ title: "a", count: 2 });
  });
});

describe("managed logical stream — terminal media guards", () => {
  const withImage = [
    {
      content: [
        { type: "text" as const, text: "here" },
        {
          type: "file" as const,
          data: "AQID",
          mediaType: "image/png",
        },
      ],
    },
  ];

  it("publishes no media before an output-media guard that strips it has run", async () => {
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel(withImage).model,
      guardrails: [
        guardrail({
          id: "strip-generated-image",
          on: boundary.output.media(),
          run: () => ({ action: "strip", reason: "remove generated image" }),
        }),
      ],
    });

    const events = await collect(result.fullStream);
    await result.completion;

    // The guard removed it, so it must never have reached a public surface —
    // publication means finality (RFC #173, laws 2 and 3).
    expect(events.filter((event) => event.type === "media")).toEqual([]);
  });

  it("still publishes media that the guard allows", async () => {
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel(withImage).model,
      guardrails: [
        guardrail({
          id: "allow-generated-image",
          on: boundary.output.media(),
          run: () => ({ action: "allow" }),
        }),
      ],
    });

    const events = await collect(result.fullStream);
    await result.completion;

    expect(events.filter((event) => event.type === "media")).toHaveLength(1);
  });
});

describe("managed logical stream — terminal text guards over reasoning", () => {
  const withReasoning = [
    {
      content: [
        { type: "reasoning" as const, text: "the SSN is 123-45-6789" },
        { type: "text" as const, text: "done" },
      ],
    },
  ];

  it("publishes no reasoning before a terminal text guard that rewrites it has run", async () => {
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel(withReasoning).model,
      guardrails: [
        guardrail({
          id: "redact-pii",
          on: boundary.output.text(),
          run: (value: string) =>
            value.includes("123-45-6789")
              ? {
                  action: "rewrite",
                  value: value.replace("123-45-6789", "[redacted]"),
                  rewrite: { kind: "normalize" },
                }
              : { action: "allow" },
        }),
      ],
    });

    const events = await collect(result.fullStream);
    const completion = await result.completion;

    // Completion redacts it, so no public surface may have streamed the raw
    // value first — publication means finality (RFC #173, law 2).
    expect(JSON.stringify(completion.content)).not.toContain("123-45-6789");
    const reasoning = events
      .filter(
        (event): event is Extract<StreamEvent<unknown>, { type: "reasoning-delta" }> =>
          event.type === "reasoning-delta",
      )
      .map((event) => event.text)
      .join("");
    expect(reasoning).not.toContain("123-45-6789");
    expect(reasoning).toContain("[redacted]");
  });

  it("still publishes reasoning progressively when nothing can rewrite it", async () => {
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel(withReasoning).model,
    });

    const events = await collect(result.fullStream);
    await result.completion;

    // No terminal text binding, so early release stays local (law 5).
    expect(
      events.filter((event) => event.type === "reasoning-delta"),
    ).not.toHaveLength(0);
  });
});

describe("managed logical stream — framing", () => {
  it("emits one start and one finish across a retry, with no provider step frames", async () => {
    const result = await createCruxAi().stream(structured, {
      model: capturingStreamingEmissionModel([
        { text: '{"title":"a","count":-1}' },
        { text: '{"title":"a","count":2}' },
      ]).model,
      constraints: [countPositive],
    });

    const events = await collect(result.fullStream);
    const types = events.map((event) => event.type);

    expect(types.filter((type) => type === "start")).toHaveLength(1);
    expect(types.filter((type) => type === "finish")).toHaveLength(1);
    expect(types[0]).toBe("start");
    expect(types.at(-1)).toBe("finish");
    // Provider framing is not part of the logical vocabulary.
    for (const type of types) {
      expect(type).not.toMatch(/^(start-step|finish-step|text-start|text-end|raw|abort|error)$/);
    }
  });

  it("carries the operation finish reason on the finish event", async () => {
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel([{ text: "answered" }]).model,
    });

    const events = await collect(result.fullStream);
    const finish = events.at(-1) as Extract<
      StreamEvent<unknown>,
      { type: "finish" }
    >;

    // UI helpers close from this event instead of separately awaiting completion.
    expect(finish.type).toBe("finish");
    expect(finish.finishReason).toBeDefined();
  });
});

describe("managed logical stream — surfaces", () => {
  it("settles completion without any surface being read", async () => {
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel([{ text: "answered" }]).model,
    });

    // Publication never waits for a consumer, so this cannot deadlock.
    const completion = await Promise.race([
      result.completion,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("completion deadlocked")), 5000),
      ),
    ]);
    expect((completion as { text: string }).text).toBe("answered");
  });

  it("replays the full sequence to a surface first read after completion", async () => {
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel([{ text: "answered" }]).model,
    });
    await result.completion;

    // A late reader still sees the operation from logical `start`.
    const events = await collect(result.fullStream);
    expect(events[0]?.type).toBe("start");
    expect(events.at(-1)?.type).toBe("finish");
    expect(await collect(result.textStream)).toEqual(["answered"]);
  });

  it("serves two surfaces concurrently without either stealing from the other", async () => {
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel([{ text: "answered" }]).model,
    });

    const [text, events] = await Promise.all([
      collect(result.textStream),
      collect(result.fullStream),
    ]);

    expect(text.join("")).toBe("answered");
    expect(events.filter((event) => event.type === "text-delta")).toHaveLength(
      text.length,
    );
  });

  it("returns one stable stream object per surface", async () => {
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel([{ text: "answered" }]).model,
    });

    expect(result.textStream).toBe(result.textStream);
    expect(result.fullStream).toBe(result.fullStream);
    expect(result.partialOutputStream).toBe(result.partialOutputStream);
    await result.completion;
  });
});

describe("managed logical stream — cancellation", () => {
  it("aborts the physical attempt and rejects every surface with one identity", async () => {
    const stalling = stallingModel();
    const result = await createCruxAi().stream(textOnly, {
      model: stalling.model,
    });

    result.cancel();

    // The provider attempt itself is aborted — a cancelled operation must not
    // leave a live request behind.
    expect(stalling.signal()?.aborted).toBe(true);

    const surfaceError = await collect(result.textStream).then(
      () => undefined,
      (error: unknown) => error,
    );
    const completionError = await result.completion.then(
      () => undefined,
      (error: unknown) => error,
    );

    expect((surfaceError as Error)?.name).toBe("AbortError");
    // The SAME object, so a caller can correlate the two without guessing.
    expect(completionError).toBe(surfaceError);
  });

  it("is a no-op once the operation has already finished", async () => {
    const result = await createCruxAi().stream(textOnly, {
      model: capturingStreamingEmissionModel([{ text: "answered" }]).model,
    });
    const completion = await result.completion;

    result.cancel();

    // A finished operation stays finished: cancellation cannot rewrite history.
    await expect(result.completion).resolves.toBe(completion);
  });
});

describe("managed logical stream — UI helpers", () => {
  it("contains only committed events for a retried operation", async () => {
    const result = await createCruxAi().stream(structured, {
      model: capturingStreamingEmissionModel([
        { text: '{"title":"a","count":-1}' },
        { text: '{"title":"a","count":2}' },
      ]).model,
      constraints: [countPositive],
    });

    const reader = toUIMessageStream(result).getReader();
    const chunks: unknown[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }

    expect(JSON.stringify(chunks)).not.toContain('"count":-1');
    expect(JSON.stringify(chunks)).toContain("count");
  });
});
