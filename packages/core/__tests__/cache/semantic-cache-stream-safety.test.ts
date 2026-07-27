import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt } from "../../src/prompt/prompt";
import { boundary, guardrail } from "../../src/safety";
import { resetHooks } from "../../src/runtime/runtime";
import {
  attachCachedReleaseSeal,
  readCachedReleaseSeal,
} from "../../src/runtime/internal/cached-release-seal";
import {
  streamCachedPair,
  type StreamRegime,
} from "./semantic-cache-stream-safety.fixtures";

const regimes: readonly StreamRegime[] = ["core", "sdk"];

afterEach(() => {
  resetHooks();
  vi.restoreAllMocks();
});

describe.each(regimes)("semantic cache stream safety — %s", (regime) => {
  it("rejects an enforcing cached output block before replay publication", async () => {
    let blockCached = false;
    const pair = await streamCachedPair({
      regime,
      kind: "text",
      prompt: textPrompt(`stream-block-${regime}`),
      cachedOutput: "cached secret",
      liveChunks: ["fresh ", "text"],
      call: {
        guardrails: [
          guardrail({
            id: `stream-cache-block-${regime}`,
            on: boundary.output.text(),
            run: (text) =>
              blockCached && text === "cached secret"
                ? { action: "block", reason: "current policy" }
                : { action: "allow" },
          }),
        ],
      },
      between: () => {
        blockCached = true;
      },
    });

    expect(pair.providerGenerateCalls).toBe(1);
    expect(pair.providerStreamCalls).toBe(1);
    expect(pair.replayCalls).toBe(0);
    expect(pair.text).toBe("fresh text");
    expect(JSON.stringify(pair.meta)).not.toContain("cached secret");
  });

  it("replays one accepted rewrite without evaluating it again", async () => {
    let evaluateCurrentPolicy = false;
    const currentSubjects: string[] = [];
    const pair = await streamCachedPair({
      regime,
      kind: "text",
      prompt: textPrompt(`stream-rewrite-${regime}`),
      cachedOutput: "cached text",
      call: {
        guardrails: [
          guardrail({
            id: `stream-cache-rewrite-${regime}`,
            on: boundary.output.text().deltas(),
            run: (text) => {
              if (!evaluateCurrentPolicy) return { action: "allow" };
              currentSubjects.push(text);
              return {
                action: "rewrite",
                value: text === "cached text" ? "safe text" : "double text",
                rewrite: { kind: "normalize" },
              };
            },
          }),
        ],
      },
      between: () => {
        evaluateCurrentPolicy = true;
      },
    });

    expect(pair.providerStreamCalls).toBe(0);
    expect(pair.text).toBe("safe text");
    expect(currentSubjects).toEqual(["cached text"]);
    expect(JSON.stringify(pair.publicHandle)).not.toContain(
      "cachedReleaseSeal",
    );
  });

  it("runs an authored transform exactly once for the cached stream hit", async () => {
    let transforms = 0;
    const output = z.object({ value: z.string() }).transform(({ value }) => {
      transforms++;
      return { published: value.toUpperCase() };
    });
    const pair = await streamCachedPair({
      regime,
      kind: "object",
      prompt: structuredPrompt(`stream-structured-${regime}`, output),
      cachedOutput: '{"value":"cached"}',
    });

    expect(pair.providerStreamCalls).toBe(0);
    expect(transforms).toBe(2);
    expect(pair.text).toBe('{"value":"cached"}');
    expect(pair.object).toEqual({ published: "CACHED" });
    expect(JSON.stringify(pair.publicHandle)).not.toContain(
      "cachedReleaseSeal",
    );
  });

  it("propagates malformed current policy before replay or provider fallback", async () => {
    let malformed = false;
    const run = vi.fn(() =>
      malformed
        ? ({ action: "invalid" } as never)
        : { action: "allow" as const },
    );

    await expect(
      streamCachedPair({
        regime,
        kind: "text",
        prompt: textPrompt(`stream-malformed-${regime}`),
        cachedOutput: "cached text",
        call: {
          guardrails: [
            guardrail({
              id: `stream-cache-malformed-${regime}`,
              on: boundary.output.text(),
              run,
            }),
          ],
        },
        between: () => {
          malformed = true;
        },
      }),
    ).rejects.toMatchObject({ name: "SafetyResultError" });
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("cached stream release seal", () => {
  it("is private, non-enumerable, and absent from serialization", () => {
    const target = attachCachedReleaseSeal(
      { visible: true },
      { resultKind: "text", text: "accepted" },
    );

    expect(readCachedReleaseSeal(target)).toEqual({
      resultKind: "text",
      text: "accepted",
    });
    expect(Object.keys(target)).toEqual(["visible"]);
    expect(JSON.stringify(target)).toBe('{"visible":true}');
    expect(
      Object.getOwnPropertySymbols(target).map((symbol) =>
        Object.getOwnPropertyDescriptor(target, symbol),
      ),
    ).toContainEqual(
      expect.objectContaining({
        enumerable: false,
        writable: false,
      }),
    );
  });
});

it("uses a live stream when an SDK runtime cannot construct cache replay", async () => {
  const pair = await streamCachedPair({
    regime: "sdk",
    kind: "text",
    prompt: textPrompt("stream-without-sdk-replay"),
    cachedOutput: "cached text",
    liveChunks: ["fresh text"],
    sdkReplay: false,
  });

  expect(pair.providerGenerateCalls).toBe(1);
  expect(pair.providerStreamCalls).toBe(1);
  expect(pair.replayCalls).toBe(0);
  expect(pair.text).toBe("fresh text");
});

function textPrompt(id: string) {
  return prompt({
    id,
    input: z.object({ message: z.string() }),
    cache: {
      semantic: {
        version: "v1",
        query: ({ input }) => String(input.message),
      },
    },
    prompt: ({ input }) => input.message,
  });
}

function structuredPrompt<TOutput>(id: string, output: z.ZodType<TOutput>) {
  return prompt({
    id,
    input: z.object({ message: z.string() }),
    output,
    cache: {
      semantic: {
        version: "v1",
        query: ({ input }) => String(input.message),
      },
    },
    prompt: "return JSON",
  });
}
