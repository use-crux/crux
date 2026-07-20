import { afterEach, describe, expect, it } from "vitest";
import { prompt } from "@use-crux/core";
import {
  agent,
  createConsensus,
  createFakeAgentExecutor,
} from "@use-crux/core/agent";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core/observability";

const voterPrompt = prompt({
  id: "consensus-result-correlation-prompt",
  system: "Vote on the proposal.",
});

const firstVoter = agent({
  id: "consensus-result-correlation-first",
  prompt: voterPrompt,
});

const secondVoter = agent({
  id: "consensus-result-correlation-second",
  prompt: voterPrompt,
});

afterEach(() => {
  resetObservabilityRuntime();
});

describe("consensus result correlation", () => {
  it("points the parent and voter results at their exact operation spans", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const consensus = createConsensus(
      createFakeAgentExecutor({
        agents: {
          [firstVoter.id]: { output: "approve" },
          [secondVoter.id]: { output: "approve" },
        },
      }),
    );

    const result = await consensus({
      id: "consensus-result-correlation",
      agents: [firstVoter, secondVoter],
      input: {},
      extract: (vote) => vote.output as "approve",
    });
    await observe.flush();

    const starts = transport.records.filter(
      (record) => record.type === "span:start",
    );
    const parent = starts.find(
      (record) => record.primitive === "composition.consensus",
    );
    const children = starts.filter(
      (record) => record.primitive === "agent.run",
    );

    expect(parent).toBeDefined();
    expect(result._meta).toEqual({
      traceId: parent?.traceId,
      spanId: parent?.spanId,
    });
    expect(children).toHaveLength(2);
    expect(result.details.map((detail) => detail._meta)).toEqual(
      children.map((child) => ({
        traceId: child.traceId,
        spanId: child.spanId,
      })),
    );
    expect(new Set(starts.map((record) => record.traceId))).toEqual(
      new Set([parent?.traceId]),
    );
    expect(children.every((child) => child.parentSpanId === parent?.spanId)).toBe(
      true,
    );
  });
});
