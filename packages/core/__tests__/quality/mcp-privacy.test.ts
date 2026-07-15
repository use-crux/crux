import { materializeMcpToolSource, mcp } from "@use-crux/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { adapter } from "../../src/adapter/define-adapter";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import type { ProjectIndexRuntimeUpdate } from "../../src/project-index/runtime";
import { prompt } from "../../src/prompt/prompt";
import { evaluate } from "../../src/quality";
import { resetHooks, setHooks } from "../../src/runtime/runtime";
import { runEvaluationWithRunner as run } from "./runner-harness";

describe("Quality MCP privacy", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    resetHooks();
  });

  it("omits opaque resolver failures from Quality and runtime evidence", async () => {
    const opaqueSecret = "violet-umbrella-9281";
    const runtimeUpdates: ProjectIndexRuntimeUpdate[] = [];
    const transport = createInMemoryObservabilityTransport();
    setHooks({
      projectIndexRuntimeTransport: {
        enqueue(update) {
          runtimeUpdates.push(update);
        },
        async flush() {
          return "ok";
        },
      },
    });
    setObservabilityTransport(transport);
    const source = mcp({
      id: "quality-resolver-failure",
      transport: async () => {
        throw new Error(`dependency rejected ${opaqueSecret}`);
      },
    });
    const call = vi.fn();
    const model = adapter({
      providerId: "quality-resolver-fixture",
      materializeToolSource: materializeMcpToolSource,
      mapSettings: () => ({}),
      call,
      async stream() {
        throw new Error("not used");
      },
      appendToolRound(messages) {
        return messages;
      },
    })({});
    const evaluation = evaluate("quality.mcp-resolver-privacy", {
      task: prompt({
        id: "quality-mcp-resolver-privacy",
        use: [source],
        prompt: "Do not call the provider.",
      }),
      data: [{ input: {} }],
    });

    const experiment = await run(evaluation, undefined, {
      setup: {
        generate: model.generate.bind(model) as never,
        model: "fixture-model",
      },
    });
    await observe.flush();

    expect(call).not.toHaveBeenCalled();
    expect(experiment.cells[0]?.error).toBeDefined();
    expect(
      JSON.stringify({
        experiment,
        records: transport.records,
        runtimeUpdates,
      }),
    ).not.toContain(opaqueSecret);
  });
});
