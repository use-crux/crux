import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prompt } from "@use-crux/core";
import {
  agent,
  createFakeAgentExecutor,
  createSwarm,
} from "@use-crux/core/agent";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type OperationResultMeta,
} from "@use-crux/core/observability";

const swarmPrompt = prompt({
  id: "swarm-result-correlation-prompt",
  system: "Resolve the request or transfer it.",
});

const triage = agent({
  id: "swarm-result-correlation-triage",
  prompt: swarmPrompt,
  handoffs: ["swarm-result-correlation-billing"],
});

const billing = agent({
  id: "swarm-result-correlation-billing",
  prompt: swarmPrompt,
  handoffs: [],
});

const agents = { [triage.id]: triage, [billing.id]: billing };

let transport: ReturnType<typeof createInMemoryObservabilityTransport>;

beforeEach(() => {
  transport = createInMemoryObservabilityTransport();
  setObservabilityTransport(transport);
});

afterEach(() => {
  resetObservabilityRuntime();
});

function expectSwarmOwner(meta: OperationResultMeta) {
  const parent = transport.records.find(
    (record) =>
      record.type === "span:start" &&
      record.primitive === "composition.swarm",
  );
  const end = transport.records.find(
    (record) => record.type === "span:end" && record.spanId === parent?.spanId,
  );

  expect(parent).toBeDefined();
  expect(meta).toEqual({ traceId: parent?.traceId, spanId: parent?.spanId });
  expect(end).toMatchObject({ status: "ok" });
  return parent;
}

describe("swarm result correlation", () => {
  it("owns a normal terminal result with composition.swarm", async () => {
    const result = await createSwarm(
      createFakeAgentExecutor({
        agents: { [triage.id]: { output: "resolved" } },
      }),
    )({
      id: "swarm-result-correlation-normal",
      agents,
      startAgent: triage.id,
      input: {},
    });
    await observe.flush();

    const parent = expectSwarmOwner(result._meta);
    const child = transport.records.find(
      (record) => record.type === "span:start" && record.primitive === "agent.run",
    );

    expect(result.agentResults[0]?._meta).toEqual({
      traceId: child?.traceId,
      spanId: child?.spanId,
    });
    expect(child).toMatchObject({
      traceId: parent?.traceId,
      parentSpanId: parent?.spanId,
    });
  });

  it("keeps handoff and agent spans distinct from the swarm owner", async () => {
    const result = await createSwarm(
      createFakeAgentExecutor({
        agents: {
          [triage.id]: {
            transfer: billing.id,
            reason: "billing expertise required",
          },
          [billing.id]: { output: "resolved by billing" },
        },
      }),
    )({
      id: "swarm-result-correlation-handoff",
      agents,
      startAgent: triage.id,
      input: {},
    });
    await observe.flush();

    const parent = expectSwarmOwner(result._meta);
    const starts = transport.records.filter(
      (record) => record.type === "span:start",
    );
    const children = starts.filter(
      (record) => record.primitive === "agent.run",
    );

    expect(starts.some((record) => record.primitive === "handoff.prepare")).toBe(
      true,
    );
    expect(result.agentResults.map((agentResult) => agentResult._meta)).toEqual(
      children.map((child) => ({
        traceId: child.traceId,
        spanId: child.spanId,
      })),
    );
    expect(children.every((child) => child.traceId === parent?.traceId)).toBe(
      true,
    );
  });

  it("observes dry-run results without executing an agent", async () => {
    const executor = createFakeAgentExecutor();
    const result = await createSwarm(executor)({
      id: "swarm-result-correlation-dry-run",
      agents,
      startAgent: triage.id,
      input: {},
      dryRun: true,
    });
    await observe.flush();

    expectSwarmOwner(result._meta);
    expect(executor.calls).toHaveLength(0);
    expect(
      transport.records.some(
        (record) =>
          record.type === "span:start" && record.primitive === "agent.run",
      ),
    ).toBe(false);
  });

  it("observes an early cost-abort result with the swarm owner", async () => {
    const result = await createSwarm(
      createFakeAgentExecutor({
        agents: {
          [triage.id]: {
            output: "stopped",
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
              inputTokenDetails: {},
              outputTokenDetails: {},
            },
          },
        },
      }),
    )({
      id: "swarm-result-correlation-abort",
      agents,
      startAgent: triage.id,
      input: {},
      onCost: ({ abort }) => abort(),
    });
    await observe.flush();

    expectSwarmOwner(result._meta);
    expect(result.agentResults).toHaveLength(1);
  });
});
