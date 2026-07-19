import { afterEach, describe, expect, it } from "vitest";
import { resetHooks, setHooks, type SpanActivationHook } from "@use-crux/core";
import { delegate, handoff } from "@use-crux/core/agent";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core/observability";
import { z } from "zod";

const argsSchema = z.object({ query: z.string() });
const handoffInputSchema = z.object({ findings: z.array(z.string()) });
const handoffOutputSchema = z.object({ synthesis: z.string() });

afterEach(() => {
  resetHooks();
  resetObservabilityRuntime();
});

function createResearchHandoff() {
  return handoff({
    id: "delegate-result-correlation-handoff",
    inputSchema: handoffInputSchema,
    outputSchema: handoffOutputSchema,
    transform: (input) => ({ synthesis: input.findings.join(", ") }),
  });
}

describe("delegate result correlation", () => {
  it("points only the delegate envelope at delegate.invoke", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const rawResult: z.infer<typeof handoffInputSchema> = {
      findings: ["first", "second"],
    };
    Object.freeze(rawResult.findings);
    Object.freeze(rawResult);
    const research = delegate({
      id: "delegate-result-correlation",
      argsSchema,
      handoff: createResearchHandoff(),
      execute: async () => rawResult,
    });

    const result = await research.run({ query: "evidence" }, undefined);
    await observe.flush();

    const starts = transport.records.filter(
      (record) => record.type === "span:start",
    );
    const owner = starts.find(
      (record) => record.primitive === "delegate.invoke",
    );
    const handoffSpans = starts.filter(
      (record) => record.primitive === "handoff.prepare",
    );

    expect(owner).toBeDefined();
    expect(result._meta).toEqual({
      traceId: owner?.traceId,
      spanId: owner?.spanId,
    });
    expect(handoffSpans.length).toBeGreaterThan(0);
    expect(handoffSpans.every((span) => span.spanId !== result._meta.spanId)).toBe(
      true,
    );
    expect(rawResult).not.toHaveProperty("_meta");
    expect(result.data).toEqual({ synthesis: "first, second" });
    expect(result.data).not.toHaveProperty("_meta");
  });

  it("records activation cleanup failures on delegate.invoke", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let activations = 0;
    const failAfterCallback = ((_context, run) => {
      const activation = ++activations;
      const value = run();
      if (activation !== 1) return value;
      return Promise.resolve(value).then(() => {
        throw new Error("delegate cleanup failed");
      });
    }) as SpanActivationHook;
    setHooks({ spanActivationHook: failAfterCallback });
    const research = delegate({
      id: "delegate-result-correlation-cleanup",
      argsSchema,
      handoff: createResearchHandoff(),
      execute: async () => ({ findings: ["finding"] }),
    });

    await expect(
      research.run({ query: "evidence" }, undefined),
    ).rejects.toThrow("delegate cleanup failed");
    await observe.flush();

    const owner = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "delegate.invoke",
    );
    const end = transport.records.find(
      (record) => record.type === "span:end" && record.spanId === owner?.spanId,
    );

    expect(owner).toBeDefined();
    expect(end).toMatchObject({ status: "error" });
  });
});
