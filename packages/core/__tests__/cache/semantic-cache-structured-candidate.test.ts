import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt } from "../../src/prompt/prompt";
import { boundary, constraint, guardrail } from "../../src/safety";
import { resetHooks } from "../../src/runtime/runtime";
import type { JsonObject } from "../../src/storage";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import {
  generateCachedPair,
  type GenerateRegime,
} from "./semantic-cache-generate-safety.fixtures";

const regimes: readonly GenerateRegime[] = ["core", "sdk"];

afterEach(() => {
  resetHooks();
  resetObservabilityRuntime();
  vi.restoreAllMocks();
});

describe.each(regimes)("semantic cache structured candidate — %s", (regime) => {
  it("stores canonical z.input and never reparses prior z.output", async () => {
    let transforms = 0;
    const schema = z.object({ value: z.string() }).transform(({ value }) => {
      transforms++;
      return { published: `output:${value}` };
    });
    const pair = await generateCachedPair({
      regime,
      kind: "object",
      prompt: structuredPrompt(`canonical-input-${regime}`, schema),
      providerOutputs: ['{"value":"input"}'],
    });

    expect(pair.providerCalls).toBe(1);
    expect(transforms).toBe(2);
    expect(pair.first.object).toEqual({ published: "output:input" });
    expect(pair.second.object).toEqual({ published: "output:input" });
    expect(pair.second._meta).toMatchObject({
      semanticCache: { hit: true },
    });
  });

  it("runs current output rewrite before one schema parse and constraints", async () => {
    let rewrite = false;
    let parses = 0;
    const constraintInputs: unknown[] = [];
    const schema = z
      .object({ value: z.enum(["safe", "current"]) })
      .transform((value) => {
        parses++;
        return { published: value.value };
      });
    const pair = await generateCachedPair({
      regime,
      kind: "object",
      prompt: structuredPrompt(`rewrite-order-${regime}`, schema),
      providerOutputs: ['{"value":"safe"}'],
      call: {
        guardrails: [
          guardrail({
            id: `rewrite-current-${regime}`,
            on: boundary.output.object<{ value: string }>().path("value"),
            run: (value) =>
              rewrite
                ? {
                    action: "rewrite",
                    value: "current",
                    rewrite: { kind: "normalize" },
                  }
                : { action: "allow" },
          }),
        ],
        constraints: [
          constraint({
            id: `inspect-canonical-${regime}`,
            on: boundary.output.object<{ value: string }>(),
            run: (value) => {
              constraintInputs.push(value);
              return { pass: true };
            },
          }),
        ],
      },
      between: () => {
        rewrite = true;
      },
    });

    expect(pair.providerCalls).toBe(1);
    expect(parses).toBe(2);
    expect(constraintInputs).toEqual([{ value: "safe" }, { value: "current" }]);
    expect(pair.second.object).toEqual({ published: "current" });
  });

  it("falls through once on current safeParse failure", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let acceptCached = true;
    const schema = z
      .object({ value: z.string() })
      .superRefine((_value, context) => {
        if (!acceptCached && _value.value === "cached") {
          context.addIssue({
            code: "custom",
            message: "current schema rejection",
          });
        }
      });
    const pair = await generateCachedPair({
      regime,
      kind: "object",
      prompt: structuredPrompt(`schema-rejection-${regime}`, schema),
      providerOutputs: ['{"value":"cached"}', '{"value":"fresh"}'],
      between: () => {
        acceptCached = false;
      },
    });

    expect(pair.providerCalls).toBe(2);
    expect(pair.second.text).toBe('{"value":"fresh"}');
    await observe.flush();
    expect(JSON.stringify(transport.records)).toContain(
      '"rejectionCategory":"schema"',
    );
  });

  it("propagates an unexpectedly thrown authored callback without fallback", async () => {
    let throwNow = false;
    const providerCall = vi.fn();
    const schema = z.object({ value: z.string() }).transform((value) => {
      if (throwNow) throw new Error("authored transform exploded");
      return value;
    });

    await expect(
      generateCachedPair({
        regime,
        kind: "object",
        prompt: structuredPrompt(`schema-throw-${regime}`, schema),
        providerOutputs: ['{"value":"cached"}', '{"value":"must not run"}'],
        onProviderCall: providerCall,
        between: () => {
          throwNow = true;
        },
      }),
    ).rejects.toThrow("authored transform exploded");
    expect(providerCall).toHaveBeenCalledOnce();
  });
});

describe("semantic cache private structured payload", () => {
  it.each(["missing", "malformed", "unknown-version"] as const)(
    "treats a %s payload as a schema rejection without evicting the entry",
    async (variant) => {
      const schema = z.object({ value: z.string() });
      const storage = (
        await generateCachedPair({
          regime: "core",
          kind: "object",
          prompt: structuredPrompt(`payload-${variant}`, schema),
          providerOutputs: ['{"value":"cached"}'],
        })
      ).storage;
      resetHooks();

      const page = await storage.records.list("");
      const stored = page.entries[0]!;
      const value = structuredClone(stored.value) as Record<string, unknown>;
      const result = value.result as Record<string, unknown>;
      const privateKey = Object.keys(result).find(
        (key) =>
          key !== "text" &&
          key !== "object" &&
          key !== "finishReason" &&
          key !== "usage" &&
          key !== "meta",
      );
      expect(privateKey).toBeDefined();
      if (variant === "missing") {
        delete result[privateKey!];
      } else if (variant === "malformed") {
        result[privateKey!] = null;
      } else {
        result[privateKey!] = {
          version: 999,
          canonicalInput: { value: "cached" },
        };
      }
      await storage.records.put(stored.key, value as JsonObject);

      const pair = await generateCachedPair({
        regime: "core",
        kind: "object",
        prompt: structuredPrompt(`payload-${variant}`, schema),
        providerOutputs: ['{"value":"fresh"}'],
        storage,
      });

      expect(pair.providerCalls).toBe(1);
      expect(pair.second.object).toEqual({ value: "fresh" });
      expect((await storage.records.list("")).entries).toHaveLength(1);
    },
  );

  it("stores accepted post-guard input privately while publishing only z.output", async () => {
    const schema = z
      .object({ value: z.string() })
      .transform(({ value }) => ({ published: value.toUpperCase() }));
    const pair = await generateCachedPair({
      regime: "core",
      kind: "object",
      prompt: structuredPrompt("private-payload-shape", schema),
      providerOutputs: ['{"value":"raw"}'],
      call: {
        guardrails: [
          guardrail({
            id: "rewrite-before-private-cache",
            on: boundary.output.object<{ value: string }>().path("value"),
            run: () => ({
              action: "rewrite",
              value: "safe",
              rewrite: { kind: "normalize" },
            }),
          }),
        ],
      },
    });
    const entry = (await pair.storage.records.list("")).entries[0]!.value;
    const serialized = JSON.stringify(entry);

    expect(pair.first.object).toEqual({ published: "SAFE" });
    expect(serialized).toContain('"version":1');
    expect(serialized).toContain('"canonicalInput":{"value":"safe"}');
    expect(serialized).not.toContain('"canonicalInput":{"value":"raw"}');
    expect(serialized).toContain('"object":{"published":"SAFE"}');
    expect(Object.keys(pair.first)).not.toContain("canonicalInput");
    expect(JSON.stringify(pair.first)).not.toContain("canonicalInput");
    expect(
      Object.getOwnPropertySymbols(pair.first).some(
        (symbol) =>
          Object.getOwnPropertyDescriptor(pair.first, symbol)?.enumerable ===
          false,
      ),
    ).toBe(true);
  });
});

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
