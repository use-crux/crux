import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcp, stdio } from "@use-crux/mcp";
import { afterEach, describe, expect, it } from "vitest";

import { agent } from "../../src/agent/agent";
import { loopRuntimeAdapter } from "../../src/adapter";
import { adapter } from "../../src/adapter/define-adapter";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import { context } from "../../src/prompt/context";
import { prompt } from "../../src/prompt/prompt";
import { evaluate, target } from "../../src/quality";
import { taskOutputCacheBypassReason } from "../../src/quality/internal/tool-source-cache";
import {
  TOOL_SOURCE,
  TOOL_SOURCE_QUALITY_IDENTITY,
} from "../../src/tools/tool-source";
import { createMcpQualityFixture } from "./mcp-live-fixture";
import { runEvaluationWithRunner as run } from "./runner-harness";

describe("Quality with live MCP sources", () => {
  afterEach(() => resetObservabilityRuntime());

  it("bypasses reusable outputs for a conditionally inactive nested source", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "crux-quality-mcp-cache-"));
    const fake = fakeLoopRuntime({
      loops: [[{ text: "first" }], [{ text: "second" }]],
    });
    const executor = loopRuntimeAdapter(fake.runtime);
    const source = mcp({
      id: "quality-live-server",
      transport: stdio({ command: "must-not-spawn-while-condition-is-false" }),
    });
    const conditional = context({
      id: "conditional-mcp",
      use: [source],
      when: () => false,
      system: "Never active in this case.",
    });
    const task = prompt({
      id: "quality-mcp-task",
      use: [conditional],
      prompt: "Answer directly.",
    });
    const setup = {
      generate: executor.generate.bind(executor) as never,
      model: "fake:m1",
    };
    const makeEvaluation = () =>
      evaluate("quality.mcp-cache", {
        task,
        data: [{ input: {} }],
      });

    const first = await run(makeEvaluation(), undefined, { cacheDir, setup });
    const second = await run(
      makeEvaluation(),
      { reuseOutputs: true },
      { cacheDir, setup },
    );

    expect(fake.calls.runTextLoop).toHaveLength(2);
    expect(first.cells[0]?.metadata).toMatchObject({
      outputCacheBypass: "live-tool-source",
    });
    expect(second.cells[0]).toMatchObject({
      output: "second",
      metadata: {
        outputCacheBypass: "live-tool-source",
      },
    });
    expect(second.cells[0]?.metadata?.cached).not.toBe(true);
  });

  it("allows a no-network fixture with an explicit stable identity to reuse outputs", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "crux-quality-mcp-fixture-"));
    const fixtureSource = (revision: string) =>
      Object.freeze({
        [TOOL_SOURCE]: true as const,
        [TOOL_SOURCE_QUALITY_IDENTITY]: Object.freeze({
          kind: "fixture" as const,
          id: `catalog-fixture-${revision}`,
        }),
        _tag: "ToolSource" as const,
        id: "catalog-fixture",
        kind: "mcp",
      });
    let materializations = 0;
    let providerCalls = 0;
    const model = adapter({
      providerId: "quality-fixture",
      mapSettings: () => ({}),
      async materializeToolSource() {
        materializations += 1;
        return { tools: {}, close: async () => {} };
      },
      async call() {
        providerCalls += 1;
        return {
          raw: { providerCalls },
          extracted: {
            text: "fixture-output",
            toolCalls: undefined,
            finishReason: "stop",
            responseId: `response-${providerCalls}`,
            actualModelId: "fixture-model",
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
              inputTokenDetails: {},
              outputTokenDetails: {},
            },
          },
        };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound(messages) {
        return messages;
      },
    })({});
    const makeTask = (revision: string) =>
      prompt({
        id: "quality-mcp-fixture",
        use: [fixtureSource(revision)],
        prompt: "Use the deterministic fixture.",
      });
    const makeEvaluation = (revision: string) =>
      evaluate("quality.mcp-fixture", {
        task: makeTask(revision),
        data: [{ input: {} }],
      });
    const setup = {
      generate: model.generate.bind(model) as never,
      model: "fixture-model",
    };

    await run(makeEvaluation("v1"), undefined, { cacheDir, setup });
    const reused = await run(
      makeEvaluation("v1"),
      { reuseOutputs: true },
      { cacheDir, setup },
    );

    expect(materializations).toBe(1);
    expect(providerCalls).toBe(1);
    expect(reused.cells[0]).toMatchObject({
      output: "fixture-output",
      metadata: { cached: true },
    });

    const revised = await run(
      makeEvaluation("v2"),
      { reuseOutputs: true },
      { cacheDir, setup },
    );

    expect(materializations).toBe(2);
    expect(providerCalls).toBe(2);
    expect(revised.cells[0]?.metadata?.cached).not.toBe(true);
  });

  it("discovers an exposed-name mock but never invokes remote execution", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "crux-quality-mcp-mock-"));
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const source = mcp({
      id: "quality-catalog",
      transport: stdio({ command: "represented-by-test-materializer" }),
      tools: { prefix: "catalog_" },
    });
    const exposedName = "catalog_lookup";
    const fixture = createMcpQualityFixture(source, exposedName);
    const assistant = agent({
      id: "quality-mcp-agent",
      prompt: prompt({
        id: "quality-mcp-mock",
        use: [source],
        prompt: "Look up item 42.",
      }),
      tools: { [exposedName]: { description: "catalog lookup" } } as never,
    });
    const qualityTask = target.agent(assistant, {
      generate: fixture.model.generate.bind(fixture.model) as never,
      tools: { [exposedName]: { mocked: true } },
    });
    expect(taskOutputCacheBypassReason(qualityTask)).toBe("live-tool-source");
    const evaluation = evaluate("quality.mcp-mock", {
      task: qualityTask,
      data: [{ input: {} }],
    });

    const experiment = await run(
      evaluation,
      { reuseOutputs: true },
      { cacheDir },
    );
    await observe.flush();

    expect(fixture.counts()).toEqual({
      discoveries: 1,
      providerCalls: 2,
      remoteCalls: 0,
    });
    expect(experiment.cells).toHaveLength(1);
    expect(experiment.cells[0]).toMatchObject({
      metadata: { outputCacheBypass: "live-tool-source" },
    });
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "span:start",
        primitive: "tool.call",
        attributes: expect.objectContaining({
          mocked: true,
          sourceId: source.id,
          exposedName,
        }),
      }),
    );
  });

  it("makes live discovery and execution visible without marking the call mocked", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "crux-quality-mcp-live-"));
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const source = mcp({
      id: "quality-live-catalog",
      transport: stdio({ command: "represented-by-test-materializer" }),
      tools: { prefix: "catalog_" },
    });
    const exposedName = "catalog_lookup";
    const fixture = createMcpQualityFixture(source, exposedName);
    const evaluation = evaluate("quality.mcp-live", {
      task: target.agent(
        agent({
          id: "quality-live-mcp-agent",
          prompt: prompt({
            id: "quality-live-mcp",
            use: [source],
            prompt: "Look up item 42.",
          }),
        }),
        { generate: fixture.model.generate.bind(fixture.model) as never },
      ),
      data: [{ input: {} }],
    });

    const experiment = await run(
      evaluation,
      { reuseOutputs: true },
      { cacheDir },
    );
    await observe.flush();

    expect(fixture.counts()).toEqual({
      discoveries: 1,
      providerCalls: 2,
      remoteCalls: 1,
    });
    expect(experiment.cells[0]).toMatchObject({
      metadata: { outputCacheBypass: "live-tool-source" },
    });
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "span:start",
        primitive: "mcp.discover",
        attributes: expect.objectContaining({ sourceId: source.id }),
      }),
    );
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "span:start",
        primitive: "tool.call",
        attributes: expect.not.objectContaining({ mocked: true }),
      }),
    );
  });
});
