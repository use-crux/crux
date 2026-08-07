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
import { inMemoryStorage } from "../../src/storage";
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

it("returns an SDK cache hit that omits provider steps", async () => {
  const result = await generateCachedPair({
    regime: "sdk",
    kind: "text",
    prompt: textPrompt("cache-hit-without-provider-steps"),
    providerOutputs: ["cached text"],
  });

  expect(Object.hasOwn(result.second, "steps")).toBe(false);
  expect(result.second._meta).toMatchObject({
    semanticCache: { hit: true },
  });
});

describe.each(regimes)("semantic cache generate safety — %s", (regime) => {
  it("accepts a valid cached text without another provider call", async () => {
    const result = await generateCachedPair({
      regime,
      kind: "text",
      prompt: textPrompt(`valid-text-${regime}`),
      providerOutputs: ["cached text"],
    });

    expect(result.providerCalls).toBe(1);
    expect(result.second.text).toBe("cached text");
    expect(result.second._meta).toMatchObject({
      semanticCache: { hit: true },
    });
  });

  it("turns an enforcing output block into one fresh provider call", async () => {
    let block = false;
    const result = await generateCachedPair({
      regime,
      kind: "text",
      prompt: textPrompt(`blocked-text-${regime}`),
      providerOutputs: ["cached text", "fresh text"],
      call: {
        guardrails: [
          guardrail({
            id: `cache-block-${regime}`,
            on: boundary.output.text(),
            run: (text) =>
              block && text === "cached text"
                ? { action: "block", reason: "current policy" }
                : { action: "allow" },
          }),
        ],
      },
      between: () => {
        block = true;
      },
    });

    expect(result.providerCalls).toBe(2);
    expect(result.second.text).toBe("fresh text");
    expect(result.second._meta).toMatchObject({
      semanticCache: { hit: false, written: true },
    });
  });

  it("rejects a cached constraint failure without corrective regeneration", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let requireFresh = false;
    const checks: string[] = [];
    const result = await generateCachedPair({
      regime,
      kind: "text",
      prompt: textPrompt(`constraint-text-${regime}`),
      providerOutputs: ["cached text", "fresh text"],
      call: {
        constraints: [
          constraint({
            id: `cache-constraint-${regime}`,
            on: boundary.output.text(),
            maxRetries: 3,
            run: (text) => {
              checks.push(text);
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

    expect(result.providerCalls).toBe(2);
    expect(checks).toEqual(["cached text", "cached text", "fresh text"]);
    expect(result.second.text).toBe("fresh text");
    expect(JSON.stringify(result.providerMessages[1] ?? [])).not.toContain(
      "must be fresh",
    );
    await observe.flush();
    expect(JSON.stringify(transport.records)).toContain(
      '"rejectionCategory":"constraint"',
    );
  });

  it("accepts report-mode failures and replaces stale safety audit", async () => {
    let reportFailure = false;
    const result = await generateCachedPair({
      regime,
      kind: "text",
      prompt: textPrompt(`report-text-${regime}`),
      providerOutputs: ["cached text"],
      call: {
        guardrails: [
          guardrail({
            id: `cache-report-${regime}`,
            mode: "report",
            on: boundary.output.text(),
            run: () =>
              reportFailure
                ? { action: "warn", reason: "current report" }
                : { action: "allow" },
          }),
        ],
        constraints: [
          constraint({
            id: `cache-report-constraint-${regime}`,
            on: boundary.output.text(),
            run: () => ({
              pass: false,
              feedback: "report-only finding",
            }),
          }),
        ],
        safety: {
          tune: {
            [`cache-report-constraint-${regime}`]: { mode: "report" },
          },
        },
      },
      between: () => {
        reportFailure = true;
      },
    });

    expect(result.providerCalls).toBe(1);
    expect(result.second._meta).toMatchObject({
      semanticCache: { hit: true },
      guardrails: {
        applied: [
          {
            guard: `cache-report-${regime}`,
            mode: "report",
            action: "warn",
          },
        ],
      },
      constraints: {
        entries: [
          {
            constraint: `cache-report-constraint-${regime}`,
            pass: false,
            attempts: 1,
          },
        ],
      },
    });
  });

  it("propagates malformed callback output without a provider fallback", async () => {
    let malformed = false;
    const providerCall = vi.fn();
    const run = vi.fn(() =>
      malformed
        ? ({ action: "invalid" } as never)
        : { action: "allow" as const },
    );

    await expect(
      generateCachedPair({
        regime,
        kind: "text",
        prompt: textPrompt(`malformed-text-${regime}`),
        providerOutputs: ["cached text", "must not run"],
        onProviderCall: providerCall,
        call: {
          guardrails: [
            guardrail({
              id: `cache-malformed-${regime}`,
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
    expect(providerCall).toHaveBeenCalledOnce();
  });
});

describe("semantic cache rejection observability", () => {
  it("emits only the privacy-safe rejection category and keeps the entry", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const storage = inMemoryStorage();
    const deleteEntry = vi.spyOn(storage.records, "delete");
    let block = false;
    const pair = await generateCachedPair({
      regime: "core",
      kind: "text",
      prompt: textPrompt("cache-rejection-observability"),
      providerOutputs: ["cached text", "fresh text"],
      storage,
      call: {
        guardrails: [
          guardrail({
            id: "private-policy-id",
            on: boundary.output.text(),
            run: (text) =>
              block && text === "cached text"
                ? { action: "block", reason: `secret:${text}` }
                : { action: "allow" },
          }),
        ],
      },
      between: () => {
        block = true;
      },
    });
    await observe.flush();

    const rejectionRecords = transport.records.filter((record) => {
      const serialized = JSON.stringify(record);
      return (
        serialized.includes("semantic-cache.reject") ||
        serialized.includes("lookup-reject") ||
        serialized.includes("rejectionCategory")
      );
    });
    const serialized = JSON.stringify(rejectionRecords);
    expect(serialized).toContain('"rejectionCategory":"guardrail"');
    expect(serialized).not.toContain("secret:cached text");
    expect(serialized).not.toContain("private-policy-id");
    const stored = await pair.storage.records.list("");
    expect(stored.entries).toHaveLength(1);
    expect(deleteEntry).not.toHaveBeenCalled();
  });
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
