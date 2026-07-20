import { afterEach, describe, expect, it, vi } from "vitest";

import {
  config,
  createInMemoryObservabilityTransport,
  observe,
  orchestrateGenerate,
  resetHooks,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxPlugin,
  type OrchestrationSpec,
} from "@use-crux/core";
import {
  createCruxSpanId,
  createCruxTraceId,
} from "@use-crux/core/observability";

describe("middleware result correlation", () => {
  afterEach(() => {
    resetHooks();
    resetObservabilityRuntime();
  });

  it("exposes the current generation.call identity after await next()", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let downstreamResult: Record<string, unknown> | undefined;
    const runtime = config({
      generation: {
        middleware: async (args, next) => {
          const result = await next(args);
          downstreamResult = result;
          return result;
        },
      },
    });

    try {
      const result = await orchestrateGenerate(generationSpec(), async () => ({
        text: "hello",
        _meta: { responseId: "provider-response" },
      }));
      await observe.flush();

      const span = transport.records.find(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "generation.call",
      );
      expect(span).toBeDefined();
      expect(downstreamResult).toMatchObject({
        _meta: {
          responseId: "provider-response",
          traceId: span?.traceId,
          spanId: span?.spanId,
        },
      });
      expect(result._meta).toMatchObject({
        traceId: span?.traceId,
        spanId: span?.spanId,
      });
    } finally {
      runtime.dispose();
    }
  });

  it("exposes an inner pass-through result to an outer middleware", async () => {
    let innerResult: Record<string, unknown> | undefined;
    let outerResult: Record<string, unknown> | undefined;
    const outerPlugin: CruxPlugin = {
      name: "outer-result-observer",
      install: () => ({
        middleware: async (args, next) => {
          const result = await next(args);
          outerResult = result;
          return result;
        },
      }),
    };
    const runtime = config({
      generation: {
        middleware: async (args, next) => {
          const result = await next(args);
          innerResult = result;
          return result;
        },
      },
      plugins: [outerPlugin],
    });

    try {
      const result = await orchestrateGenerate(generationSpec(), async () => ({
        text: "hello",
      }));

      expect(innerResult).toMatchObject({ _meta: result._meta });
      expect(outerResult).toMatchObject({ _meta: result._meta });
    } finally {
      runtime.dispose();
    }
  });

  it("finalizes an inner short-circuit before exposing it to an outer middleware", async () => {
    let outerResult: Record<string, unknown> | undefined;
    const shortCircuit = {
      text: "cached",
      _meta: { responseId: "cached-response" },
    };
    const outerPlugin: CruxPlugin = {
      name: "outer-short-circuit-observer",
      install: () => ({
        middleware: async (args, next) => {
          const result = await next(args);
          outerResult = result;
          return result;
        },
      }),
    };
    const runtime = config({
      generation: { middleware: async () => shortCircuit },
      plugins: [outerPlugin],
    });

    try {
      const result = await orchestrateGenerate(generationSpec(), async () => {
        throw new Error("short-circuit should skip the adapter");
      });

      expect(outerResult).toMatchObject({
        text: "cached",
        _meta: {
          responseId: "cached-response",
          traceId: result._meta.traceId,
          spanId: result._meta.spanId,
        },
      });
    } finally {
      runtime.dispose();
    }
  });

  it("overwrites forged IDs on an inner replacement before the outer layer sees it", async () => {
    const forged = {
      traceId: createCruxTraceId(),
      spanId: createCruxSpanId(),
    };
    let outerResult: Record<string, unknown> | undefined;
    const runtime = config({
      generation: {
        middleware: async (args, next) => {
          await next(args);
          return {
            text: "inner replacement",
            _meta: { responseId: "inner-response", ...forged },
          };
        },
      },
      plugins: [resultObserverPlugin((result) => (outerResult = result))],
    });

    try {
      const result = await orchestrateGenerate(generationSpec(), async () => ({
        text: "provider result",
      }));

      expect(outerResult).toMatchObject({
        text: "inner replacement",
        _meta: {
          responseId: "inner-response",
          traceId: result._meta.traceId,
          spanId: result._meta.spanId,
        },
      });
      expect(result._meta.traceId).not.toBe(forged.traceId);
      expect(result._meta.spanId).not.toBe(forged.spanId);
    } finally {
      runtime.dispose();
    }
  });

  it("restamps an outer replacement before onGenerate and public return", async () => {
    const forged = {
      traceId: createCruxTraceId(),
      spanId: createCruxSpanId(),
    };
    const onGenerate = vi.fn();
    const runtime = config({
      plugins: [
        {
          name: "outer-result-replacement",
          install: () => ({
            middleware: async (args, next) => {
              await next(args);
              return {
                text: "outer replacement",
                _meta: { responseId: "outer-response", ...forged },
              };
            },
          }),
        },
      ],
    });

    try {
      const baseSpec = generationSpec();
      const result = await orchestrateGenerate(
        {
          ...baseSpec,
          promptConfig: {
            hooks: { onGenerate },
          } as typeof baseSpec.promptConfig,
        },
        async () => ({ text: "provider result" }),
      );

      expect(result).toMatchObject({
        text: "outer replacement",
        _meta: { responseId: "outer-response" },
      });
      expect(result._meta.traceId).not.toBe(forged.traceId);
      expect(result._meta.spanId).not.toBe(forged.spanId);
      expect(onGenerate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ _meta: result._meta }),
      );
    } finally {
      runtime.dispose();
    }
  });

  it("keeps pass-through result identity after the first finalization", async () => {
    let innerResult: Record<string, unknown> | undefined;
    let outerResult: Record<string, unknown> | undefined;
    const runtime = config({
      generation: {
        middleware: async (args, next) => {
          const result = await next(args);
          innerResult = result;
          return result;
        },
      },
      plugins: [resultObserverPlugin((result) => (outerResult = result))],
    });

    try {
      const result = await orchestrateGenerate(generationSpec(), async () => ({
        text: "provider result",
      }));

      expect(innerResult).toBeDefined();
      expect(outerResult).toBe(innerResult);
      expect(result).toBe(innerResult);
    } finally {
      runtime.dispose();
    }
  });
});

function resultObserverPlugin(
  observeResult: (result: Record<string, unknown>) => void,
): CruxPlugin {
  return {
    name: "outer-result-observer",
    install: () => ({
      middleware: async (args, next) => {
        const result = await next(args);
        observeResult(result);
        return result;
      },
    }),
  };
}

function generationSpec(): OrchestrationSpec<Record<string, unknown>> {
  return {
    promptId: "middleware-result-correlation",
    promptConfig: {} as OrchestrationSpec["promptConfig"],
    preparedArgs: { model: "model-1", messages: [] },
    model: "model-1",
    input: { message: "Hello" },
    operation: "generate",
    provider: "provider",
    outputMode: "text",
  };
}
