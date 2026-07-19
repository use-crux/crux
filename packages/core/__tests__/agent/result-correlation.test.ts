import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  prompt,
  resetHooks,
  setHooks,
  type SpanActivationHook,
} from "@use-crux/core";
import {
  agent,
  createFakeAgentExecutor,
  createParallel,
  createPipeline,
  type AgentExecutor,
  type AgentResultPayload,
} from "@use-crux/core/agent";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxSpanId,
} from "@use-crux/core/observability";

const reviewPrompt = prompt({
  id: "result-correlation-review",
  input: z.object({ content: z.string() }),
  output: z.object({ verdict: z.string() }),
  system: "Review the content.",
});

const reviewer = agent({
  id: "result-correlation-reviewer",
  prompt: reviewPrompt,
});

afterEach(() => {
  resetHooks();
  resetObservabilityRuntime();
});

describe("agent result correlation", () => {
  it("finalizes an ID-free executor payload with the exact agent.run span", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let executorPayload: AgentResultPayload | undefined;
    const executor: AgentExecutor = async (currentAgent) => {
      executorPayload = {
        agentId: currentAgent.id,
        output: { verdict: "approved" },
        durationMs: 4,
      };
      return executorPayload;
    };

    const result = await createParallel(executor)({
      id: "result-correlation-parallel",
      context: { content: "draft" },
      agents: { reviewer },
    });
    await observe.flush();

    const child = result.results.reviewer;
    const childSpan = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "agent.run",
    );

    expect(executorPayload).not.toHaveProperty("_meta");
    expect(childSpan).toBeDefined();
    expect(child._meta).toEqual({
      traceId: childSpan?.traceId,
      spanId: childSpan?.spanId,
    });
  });

  it("points a plain-function stage at agent.run rather than its flow.step marker", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await createPipeline(createFakeAgentExecutor())({
      id: "plain-function-result-correlation",
      context: { content: "draft" },
      steps: [
        {
          name: "format",
          fn: async () => ({ formatted: true }),
        },
      ],
    });
    await observe.flush();

    const flowStep = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "flow.step",
    );
    const agentRun = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "agent.run",
    );
    const stage = result.results[0];

    expect(flowStep).toBeDefined();
    expect(agentRun).toMatchObject({ parentSpanId: flowStep?.spanId });
    expect(stage?._meta).toEqual({
      traceId: agentRun?.traceId,
      spanId: agentRun?.spanId,
    });
    expect(stage?._meta.spanId).not.toBe(flowStep?.spanId);
  });

  it("ends the composition span as error when context activation throws", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    setHooks({
      spanActivationHook: () => {
        throw new Error("composition activation failed");
      },
    });

    await expect(
      createParallel(createFakeAgentExecutor())({
        id: "composition-activation-error",
        context: {},
        agents: {},
      }),
    ).rejects.toThrow("composition activation failed");
    await observe.flush();

    const start = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "composition.parallel",
    );
    const end = transport.records.find(
      (record) => record.type === "span:end" && record.spanId === start?.spanId,
    );

    expect(start).toBeDefined();
    expect(end).toMatchObject({ status: "error" });
  });

  it("records a parent activation cleanup failure as error instead of success", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const throwAfterCallback = ((_context, run) =>
      Promise.resolve(run()).then(() => {
        throw new Error("composition cleanup failed");
      })) as SpanActivationHook;
    setHooks({ spanActivationHook: throwAfterCallback });

    await expect(
      createParallel(createFakeAgentExecutor())({
        id: "composition-cleanup-error",
        context: {},
        agents: {},
      }),
    ).rejects.toThrow("composition cleanup failed");
    await observe.flush();

    const start = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "composition.parallel",
    );
    const end = transport.records.find(
      (record) => record.type === "span:end" && record.spanId === start?.spanId,
    );

    expect(start).toBeDefined();
    expect(end).toMatchObject({ status: "error" });
  });

  it("ends child and parent spans as error when agent context activation throws", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let activations = 0;
    setHooks({
      spanActivationHook: (_context, run) => {
        activations += 1;
        if (activations === 2) throw new Error("agent activation failed");
        return run();
      },
    });

    await expect(
      createParallel(createFakeAgentExecutor({ fallback: "echo" }))({
        id: "agent-activation-error",
        context: { content: "draft" },
        agents: { reviewer },
      }),
    ).rejects.toThrow("agent activation failed");
    await observe.flush();

    const starts = transport.records.filter(
      (record) => record.type === "span:start",
    );
    const parent = starts.find(
      (record) => record.primitive === "composition.parallel",
    );
    const child = starts.find((record) => record.primitive === "agent.run");
    const endStatusFor = (spanId: CruxSpanId | undefined) =>
      transport.records.find(
        (record) => record.type === "span:end" && record.spanId === spanId,
      )?.status;

    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(endStatusFor(parent?.spanId)).toBe("error");
    expect(endStatusFor(child?.spanId)).toBe("error");
  });

  it("records an agent activation cleanup failure on both child and parent", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let activations = 0;
    const throwAfterChildCallback = ((_context, run) => {
      activations += 1;
      const result = run();
      if (activations !== 2) return result;
      return Promise.resolve(result).then(() => {
        throw new Error("agent cleanup failed");
      });
    }) as SpanActivationHook;
    setHooks({ spanActivationHook: throwAfterChildCallback });

    await expect(
      createParallel(createFakeAgentExecutor({ fallback: "echo" }))({
        id: "agent-cleanup-error",
        context: { content: "draft" },
        agents: { reviewer },
      }),
    ).rejects.toThrow("agent cleanup failed");
    await observe.flush();

    const starts = transport.records.filter(
      (record) => record.type === "span:start",
    );
    const parent = starts.find(
      (record) => record.primitive === "composition.parallel",
    );
    const child = starts.find((record) => record.primitive === "agent.run");
    const endStatusFor = (spanId: CruxSpanId | undefined) =>
      transport.records.find(
        (record) => record.type === "span:end" && record.spanId === spanId,
      )?.status;

    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(endStatusFor(parent?.spanId)).toBe("error");
    expect(endStatusFor(child?.spanId)).toBe("error");
  });
});
