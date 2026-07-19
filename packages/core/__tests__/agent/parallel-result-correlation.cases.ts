import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { prompt } from "@use-crux/core";
import {
  agent,
  createFakeAgentExecutor,
  createParallel,
  type AgentExecutor,
} from "@use-crux/core/agent";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxSpanId,
} from "@use-crux/core/observability";

const branchPrompt = prompt({
  id: "parallel-correlation-branch",
  input: z.object({ content: z.string() }),
  output: z.object({ branch: z.string() }),
  system: "Process one branch.",
});

const firstAgent = agent({
  id: "parallel-correlation-first",
  prompt: branchPrompt,
});
const secondAgent = agent({
  id: "parallel-correlation-second",
  prompt: branchPrompt,
});

export function registerParallelResultCorrelationCases(): void {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  describe("parallel result correlation", () => {
    it("owns the parent while children retain distinct exact agent.run identities", async () => {
      const transport = createInMemoryObservabilityTransport();
      setObservabilityTransport(transport);
      const parallel = createParallel(
        createFakeAgentExecutor({
          agents: {
            "parallel-correlation-first": { output: { branch: "first" } },
            "parallel-correlation-second": { output: { branch: "second" } },
          },
        }),
      );

      const result = await parallel({
        id: "parallel-result-correlation",
        context: { content: "draft" },
        agents: { first: firstAgent, second: secondAgent },
      });
      await observe.flush();

      const starts = transport.records.filter(
        (record) => record.type === "span:start",
      );
      const parent = starts.find(
        (record) => record.primitive === "composition.parallel",
      );
      const first = starts.find(
        (record) =>
          record.primitive === "agent.run" &&
          record.attributes?.agentId === "parallel-correlation-first",
      );
      const second = starts.find(
        (record) =>
          record.primitive === "agent.run" &&
          record.attributes?.agentId === "parallel-correlation-second",
      );
      const successfulEndFor = (spanId: CruxSpanId | undefined) =>
        transport.records.find(
          (record) => record.type === "span:end" && record.spanId === spanId,
        );

      expect(parent).toBeDefined();
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(result._meta).toEqual({
        traceId: parent?.traceId,
        spanId: parent?.spanId,
      });
      expect(result.results.first._meta).toEqual({
        traceId: first?.traceId,
        spanId: first?.spanId,
      });
      expect(result.results.second._meta).toEqual({
        traceId: second?.traceId,
        spanId: second?.spanId,
      });
      expect(
        new Set([parent?.traceId, first?.traceId, second?.traceId]).size,
      ).toBe(1);
      expect(
        new Set([parent?.spanId, first?.spanId, second?.spanId]).size,
      ).toBe(3);
      expect(successfulEndFor(parent?.spanId)).toMatchObject({ status: "ok" });
      expect(successfulEndFor(first?.spanId)).toMatchObject({ status: "ok" });
      expect(successfulEndFor(second?.spanId)).toMatchObject({ status: "ok" });
    });

    it("finalizes an empty success envelope with its composition.parallel span", async () => {
      const transport = createInMemoryObservabilityTransport();
      setObservabilityTransport(transport);

      const result = await createParallel(createFakeAgentExecutor())({
        id: "parallel-empty-correlation",
        context: {},
        agents: {},
      });
      await observe.flush();

      const parent = transport.records.find(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "composition.parallel",
      );

      expect(result.results).toEqual({});
      expect(parent).toBeDefined();
      expect(result._meta).toEqual({
        traceId: parent?.traceId,
        spanId: parent?.spanId,
      });
    });

    it("keeps exact child identities isolated when concurrent siblings finish out of order", async () => {
      const transport = createInMemoryObservabilityTransport();
      setObservabilityTransport(transport);
      let started = 0;
      let release: () => void = () => undefined;
      const bothStarted = new Promise<void>((resolve) => {
        release = resolve;
      });
      const executor: AgentExecutor = async (currentAgent) => {
        started += 1;
        if (started === 2) release();
        await bothStarted;
        if (currentAgent.id === "parallel-correlation-first") {
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
        }
        return {
          agentId: currentAgent.id,
          output: { branch: currentAgent.id },
          durationMs: 5,
        };
      };

      const result = await createParallel(executor)({
        id: "parallel-sibling-isolation",
        context: { content: "draft" },
        agents: { first: firstAgent, second: secondAgent },
      });
      await observe.flush();

      const childSpanFor = (agentId: string) =>
        transport.records.find(
          (record) =>
            record.type === "span:start" &&
            record.primitive === "agent.run" &&
            record.attributes?.agentId === agentId,
        );

      expect(result.results.first._meta.spanId).toBe(
        childSpanFor("parallel-correlation-first")?.spanId,
      );
      expect(result.results.second._meta.spanId).toBe(
        childSpanFor("parallel-correlation-second")?.spanId,
      );
      expect(result.results.first._meta.spanId).not.toBe(
        result.results.second._meta.spanId,
      );
    });

    it("preserves successful child metadata when onError continues", async () => {
      const transport = createInMemoryObservabilityTransport();
      setObservabilityTransport(transport);
      const parallel = createParallel(
        createFakeAgentExecutor({
          agents: {
            "parallel-correlation-first": { output: { branch: "first" } },
            "parallel-correlation-second": { throws: "second failed" },
          },
        }),
      );

      const result = await parallel({
        id: "parallel-continue-correlation",
        context: { content: "draft" },
        agents: { first: firstAgent, second: secondAgent },
        onError: "continue",
      });
      await observe.flush();

      const parent = transport.records.find(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "composition.parallel",
      );
      const successfulChild = transport.records.find(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "agent.run" &&
          record.attributes?.agentId === "parallel-correlation-first",
      );

      expect(result._meta.spanId).toBe(parent?.spanId);
      expect(result.results.first._meta.spanId).toBe(successfulChild?.spanId);
      expect(result.settled?.first).toEqual({
        status: "success",
        value: result.results.first,
      });
      expect(result.settled?.second?.status).toBe("error");
    });
  });
}
