import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt } from "../../src/prompt/prompt";
import { boundary, constraint, guardrail } from "../../src/safety";
import { resetHooks } from "../../src/runtime/runtime";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import {
  streamCachedPair,
  type StreamRegime,
} from "./semantic-cache-stream-safety.fixtures";

const regimes: readonly StreamRegime[] = ["core", "sdk"];

afterEach(() => {
  resetHooks();
  resetObservabilityRuntime();
  vi.restoreAllMocks();
});

describe.each(regimes)("semantic cache stream policy — %s", (regime) => {
  it("falls through before replay when the current schema rejects cached input", async () => {
    let rejectCached = false;
    const output = z
      .object({ value: z.string() })
      .superRefine((value, context) => {
        if (rejectCached && value.value === "cached") {
          context.addIssue({
            code: "custom",
            message: "current schema rejection",
          });
        }
      });
    const pair = await streamCachedPair({
      regime,
      kind: "object",
      prompt: structuredPrompt(`stream-schema-reject-${regime}`, output),
      cachedOutput: '{"value":"cached"}',
      liveChunks: ['{"value":"fresh"}'],
      between: () => {
        rejectCached = true;
      },
    });

    expect(pair.providerStreamCalls).toBe(1);
    expect(pair.replayCalls).toBe(0);
    expect(pair.text).toBe('{"value":"fresh"}');
    expect(pair.object).toEqual({ value: "fresh" });
  });

  it("gives a rejected cached constraint no regeneration authority", async () => {
    let requireFresh = false;
    const currentSubjects: string[] = [];
    const pair = await streamCachedPair({
      regime,
      kind: "text",
      prompt: textPrompt(`stream-constraint-reject-${regime}`),
      cachedOutput: "cached text",
      liveChunks: ["fresh text"],
      call: {
        constraints: [
          constraint({
            id: `stream-cache-constraint-${regime}`,
            on: boundary.output.text(),
            maxRetries: 3,
            run: (text) => {
              if (requireFresh) currentSubjects.push(text);
              return requireFresh && text !== "fresh text"
                ? { pass: false, feedback: "must be fresh" }
                : { pass: true };
            },
          }),
        ],
      },
      between: () => {
        requireFresh = true;
      },
    });

    expect(pair.providerStreamCalls).toBe(1);
    expect(pair.replayCalls).toBe(0);
    expect(pair.text).toBe("fresh text");
    expect(currentSubjects).toEqual(["cached text", "fresh text"]);
  });

  it("accepts report-mode rejection intent and preserves current audit", async () => {
    let reportCurrent = false;
    const run = vi.fn(() =>
      reportCurrent
        ? { action: "block" as const, reason: "report only" }
        : { action: "allow" as const },
    );
    const id = `stream-cache-report-${regime}`;
    const pair = await streamCachedPair({
      regime,
      kind: "text",
      prompt: textPrompt(`stream-report-${regime}`),
      cachedOutput: "cached text",
      call: {
        guardrails: [
          guardrail({
            id,
            mode: "report",
            on: boundary.output.text(),
            run,
          }),
        ],
      },
      between: () => {
        reportCurrent = true;
      },
    });

    expect(pair.providerStreamCalls).toBe(0);
    expect(pair.text).toBe("cached text");
    expect(run).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(pair.meta)).toContain(id);
  });
});

it("does not expose a rejected cached delta in current stream telemetry", async () => {
  const transport = createInMemoryObservabilityTransport();
  setObservabilityTransport(transport);
  let blockCached = false;
  let currentRecordIndex = 0;
  const pair = await streamCachedPair({
    regime: "core",
    kind: "text",
    prompt: textPrompt("stream-rejection-privacy"),
    cachedOutput: "private cached candidate",
    liveChunks: ["fresh public text"],
    call: {
      guardrails: [
        guardrail({
          id: "stream-rejection-privacy-policy",
          on: boundary.output.text().deltas(),
          run: (text) =>
            blockCached && text === "private cached candidate"
              ? { action: "block", reason: "private reason" }
              : { action: "allow" },
        }),
      ],
    },
    between: async () => {
      await observe.flush();
      currentRecordIndex = transport.records.length;
      blockCached = true;
    },
  });
  await observe.flush();

  const currentRecords = JSON.stringify(
    transport.records.slice(currentRecordIndex),
  );
  expect(pair.text).toBe("fresh public text");
  expect(currentRecords).toContain('"rejectionCategory":"guardrail"');
  expect(currentRecords).not.toContain("private cached candidate");
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
