import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { TokenUsage } from "../../src/generation/types";
import { prompt } from "../../src/prompt/prompt";
import { resetHooks } from "../../src/runtime/runtime";
import { boundary, constraint, guardrail } from "../../src/safety";
import {
  generateCachedPair,
  type GenerateRegime,
} from "./semantic-cache-generate-safety.fixtures";

const regimes: readonly GenerateRegime[] = ["core", "sdk"];

afterEach(() => {
  resetHooks();
  vi.restoreAllMocks();
});

describe.each(regimes)(
  "semantic cache release-gate regression — %s",
  (regime) => {
    it("runs approved ingress, cache, guard, schema, constraint, then publish", async () => {
      const events: string[] = [];
      const schema = z.object({ value: z.string() }).transform((value) => {
        events.push("schema");
        return { published: value.value };
      });
      const pair = await generateCachedPair({
        regime,
        kind: "object",
        prompt: structuredPrompt(`release-order-${regime}`, schema),
        providerOutputs: ['{"value":"raw"}'],
        call: {
          guardrails: [
            guardrail({
              id: `approved-ingress-${regime}`,
              on: boundary.input.text({ from: "user" }),
              run: () => {
                events.push("input");
                return { action: "allow" };
              },
            }),
            guardrail({
              id: `canonical-output-${regime}`,
              on: boundary.output.object<{ value: string }>().path("value"),
              run: () => {
                events.push("output");
                return {
                  action: "rewrite",
                  value: "guarded",
                  rewrite: { kind: "normalize" },
                };
              },
            }),
          ],
          constraints: [
            constraint({
              id: `validated-constraint-${regime}`,
              on: boundary.output.object<{ value: string }>(),
              run: (value) => {
                events.push("constraint");
                expect(value).toEqual({ value: "guarded" });
                return { pass: true };
              },
            }),
          ],
        },
        between: () => {
          events.length = 0;
        },
      });

      expect(pair.providerCalls).toBe(1);
      expect(events).toEqual(["input", "output", "schema", "constraint"]);
      expect(pair.second.object).toEqual({ published: "guarded" });
      expect(pair.second._meta).toMatchObject({
        semanticCache: { hit: true },
      });
    });

    it("stores and replays the rewritten live result", async () => {
      const subjects: string[] = [];
      const pair = await generateCachedPair({
        regime,
        kind: "text",
        prompt: textPrompt(`rewritten-write-${regime}`),
        providerOutputs: ["raw"],
        call: {
          guardrails: [
            guardrail({
              id: `rewrite-before-write-${regime}`,
              on: boundary.output.text(),
              run: (text) => {
                subjects.push(text);
                return text === "raw"
                  ? {
                      action: "rewrite",
                      value: "safe",
                      rewrite: { kind: "normalize" },
                    }
                  : { action: "allow" };
              },
            }),
          ],
        },
      });
      const stored = JSON.stringify(
        (await pair.storage.records.list("")).entries[0]?.value,
      );

      expect(pair.providerCalls).toBe(1);
      expect(subjects).toEqual(["raw", "safe"]);
      expect(pair.first.text).toBe("safe");
      expect(pair.second.text).toBe("safe");
      expect(stored).toContain('"text":"safe"');
      expect(stored).not.toContain('"text":"raw"');
    });
  },
);

it("does not charge a rejected hit to step, retry, or billing accounting", async () => {
  let requireFresh = false;
  const cachedUsage = usage(11);
  const freshUsage = usage(22);
  const pair = await generateCachedPair({
    regime: "core",
    kind: "text",
    prompt: textPrompt("rejected-hit-accounting"),
    providerOutputs: ["cached", "fresh"],
    providerUsages: [cachedUsage, freshUsage],
    call: {
      maxSteps: 1,
      constraints: [
        constraint({
          id: "fresh-only",
          on: boundary.output.text(),
          maxRetries: 3,
          run: (text) =>
            requireFresh && text !== "fresh"
              ? { pass: false, feedback: "retry feedback" }
              : { pass: true },
        }),
      ],
    },
    between: () => {
      requireFresh = true;
    },
  });

  expect(pair.providerCalls).toBe(2);
  expect(JSON.stringify(pair.providerMessages[1])).not.toContain(
    "retry feedback",
  );
  expect(pair.second._meta).toMatchObject({ usage: freshUsage });
});

function textPrompt(id: string) {
  return prompt({
    id,
    input: z.object({ message: z.string() }),
    cache: { semantic: { version: "v1" } },
    prompt: ({ input }) => input.message,
  });
}

function structuredPrompt<TOutput>(id: string, output: z.ZodType<TOutput>) {
  return prompt({
    id,
    input: z.object({ message: z.string() }),
    output,
    cache: { semantic: { version: "v1" } },
    prompt: ({ input }) => input.message,
  });
}

function usage(totalTokens: number): TokenUsage {
  return {
    inputTokens: totalTokens - 1,
    outputTokens: 1,
    totalTokens,
    inputTokenDetails: {},
    outputTokenDetails: {},
  };
}
