/** Terminal parity for blocked retrieval context across both execution dialects. */

import { describe, expect, it } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import type { CallArgs } from "../../src/adapter/types";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import { prompt } from "../../src/prompt/prompt";
import { retriever } from "../../src/retrieval";
import { boundary, guardrail, GuardrailBlockedError } from "../../src/safety";
import { capturingRetrievalAdapter } from "./retrieval-input-safety.fixture";

describe("blocked retrieval input parity", () => {
  it("terminates Core/SDK generate and stream before any provider invocation", async () => {
    let guardRuns = 0;
    const policy = () =>
      guardrail({
        id: "block-retrieval-parity",
        on: boundary.input.text({ from: "retrieval" }),
        run: () => {
          guardRuns++;
          return { action: "block" as const, reason: "unsafe retrieval" };
        },
      });

    const coreCalls: CallArgs[] = [];
    const core = adapter(capturingRetrievalAdapter(coreCalls))({});
    await expect(
      core.generate(makePrompt(), {
        model: "test-model",
        guardrails: [policy()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError);
    await expect(
      core.stream(makePrompt(), {
        model: "test-model",
        guardrails: [policy()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError);

    const sdkGenerate = fakeLoopRuntime({ loops: [[{ text: "unreachable" }]] });
    await expect(
      loopRuntimeAdapter(sdkGenerate.runtime).generate(makePrompt(), {
        model: "fake:test-model",
        guardrails: [policy()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError);
    const sdkStream = fakeLoopRuntime({ streams: [["unreachable"]] });
    await expect(
      loopRuntimeAdapter(sdkStream.runtime).stream(makePrompt(), {
        model: "fake:test-model",
        guardrails: [policy()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError);

    expect(guardRuns).toBe(4);
    expect(coreCalls).toHaveLength(0);
    expect(sdkGenerate.calls.runTextLoop).toHaveLength(0);
    expect(sdkStream.calls.runStream).toHaveLength(0);
  });
});

function makePrompt() {
  const docs = retriever({
    id: "blocked-parity-docs",
    namespace: "handbook",
    retrieve: async () => [
      {
        namespace: "handbook",
        source: { id: "blocked.md" },
        chunkId: "0",
        content: "blocked retrieval context",
        metadata: {},
        score: 1,
      },
    ],
    context: { query: "blocked" },
  });
  return prompt({
    id: "blocked-retrieval-parity",
    use: [docs.asContext()],
    messages: () => [
      { role: "system" as const, content: "Trusted suffix." },
      { role: "user" as const, content: "Question." },
    ],
  });
}
