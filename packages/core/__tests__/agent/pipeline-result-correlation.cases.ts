import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { prompt } from "@use-crux/core";
import {
  agent,
  createFakeAgentExecutor,
  createPipeline,
} from "@use-crux/core/agent";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core/observability";

const firstPrompt = prompt({
  id: "pipeline-correlation-first-prompt",
  input: z.object({ topic: z.string() }),
  output: z.object({ finding: z.string() }),
  system: "Research a topic.",
});

const secondPrompt = prompt({
  id: "pipeline-correlation-second-prompt",
  input: z.object({ finding: z.string() }),
  output: z.object({ summary: z.string() }),
  system: "Summarize a finding.",
});

const firstAgent = agent({
  id: "pipeline-correlation-first",
  prompt: firstPrompt,
});
const secondAgent = agent({
  id: "pipeline-correlation-second",
  prompt: secondPrompt,
});

export function registerPipelineResultCorrelationCases(): void {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  describe("pipeline result correlation", () => {
    it("owns the parent while ordered children retain their exact agent.run spans", async () => {
      const transport = createInMemoryObservabilityTransport();
      setObservabilityTransport(transport);
      const pipeline = createPipeline(
        createFakeAgentExecutor({
          agents: {
            "pipeline-correlation-first": { output: { finding: "facts" } },
            "pipeline-correlation-second": { output: { summary: "done" } },
          },
        }),
      );

      const result = await pipeline({
        id: "pipeline-result-correlation",
        context: { topic: "Crux" },
        steps: [
          { name: "research", agent: firstAgent },
          {
            name: "summarize",
            agent: secondAgent,
            input: (context) => context.research as { finding: string },
          },
        ],
      });
      await observe.flush();

      const starts = transport.records.filter(
        (record) => record.type === "span:start",
      );
      const parent = starts.find(
        (record) => record.primitive === "composition.pipeline",
      );
      const children = starts.filter(
        (record) => record.primitive === "agent.run",
      );

      expect(children.map((record) => record.attributes?.agentId)).toEqual([
        "pipeline-correlation-first",
        "pipeline-correlation-second",
      ]);
      expect(result._meta).toEqual({
        traceId: parent?.traceId,
        spanId: parent?.spanId,
      });
      expect(result.results.map((child) => child._meta.spanId)).toEqual(
        children.map((child) => child.spanId),
      );
      expect(
        result.results.every(
          (child) => child._meta.traceId === parent?.traceId,
        ),
      ).toBe(true);
      expect(
        new Set([parent?.spanId, ...children.map((child) => child.spanId)])
          .size,
      ).toBe(3);
    });
  });
}
