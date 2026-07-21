/** Direct retrieval context guarded at the semantic model-input boundary. */

import { describe, expect, it } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import type { CallArgs } from "../../src/adapter/types";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import { prompt } from "../../src/prompt/prompt";
import { retriever } from "../../src/retrieval";
import { systemIngressCarrierFor } from "../../src/resolver/system-ingress-provenance";
import type { ResolvedPrompt } from "../../src/resolver/types";
import { boundary, guardrail } from "../../src/safety";
import {
  capturingRetrievalAdapter,
  consumeTextStream,
} from "./retrieval-input-safety.fixture";

describe("direct retrieval input safety", () => {
  it("rewrites default-rendered retrieval text before a Core provider call", async () => {
    const calls: CallArgs[] = [];
    const docs = retriever({
      id: "docs",
      namespace: "handbook",
      retrieve: async () => [
        {
          namespace: "handbook",
          source: { id: "policy.md" },
          chunkId: "0",
          content: "private retrieval text",
          metadata: {},
          score: 0.91,
        },
      ],
      context: { query: "policy" },
    });
    const answer = prompt({
      id: "retrieval-input-safety",
      system: "Trusted instructions.",
      use: [docs.asContext()],
      prompt: "Answer the question.",
    });

    await adapter(capturingRetrievalAdapter(calls))({}).generate(answer, {
      model: "test-model",
      guardrails: [
        guardrail({
          id: "rewrite-direct-retrieval",
          on: boundary.input.text({ from: "retrieval" }),
          run: (text, context) => {
            expect(text).toContain("private retrieval text");
            expect(context.origin).toEqual({
              source: "retrieval",
              kind: "retrieval-context",
              retrieverId: "docs",
              blockIndex: 1,
            });
            return {
              action: "rewrite",
              value: text.replace(
                "private retrieval text",
                "safe retrieval text",
              ),
              rewrite: { kind: "redact" },
            };
          },
        }),
      ],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.system).toBe(
      "Trusted instructions.\n\n" +
        "## Retrieved Context (policy)\n" +
        "- [policy.md/0] (score: 0.91) safe retrieval text",
    );
    expect(calls[0]?.systemBlocks).toBeUndefined();
  });

  it("rewrites a folded retrieval prefix without changing trusted system suffix text", async () => {
    const calls: CallArgs[] = [];
    const retrievalSeen: string[] = [];
    const instructionsSeen: string[] = [];
    const docs = retriever({
      id: "messages-docs",
      namespace: "handbook",
      retrieve: async () => [
        {
          namespace: "handbook",
          source: { id: "message.md" },
          chunkId: "0",
          content: "private folded text",
          metadata: {},
          score: 1,
        },
      ],
      context: { query: "folded" },
    });
    const answer = prompt({
      id: "retrieval-messages-input-safety",
      use: [docs.asContext()],
      messages: () => [
        { role: "system" as const, content: "Existing trusted suffix." },
        { role: "user" as const, content: "Answer the question." },
      ],
    });

    await adapter(capturingRetrievalAdapter(calls))({}).generate(answer, {
      model: "test-model",
      guardrails: [
        guardrail({
          id: "rewrite-folded-retrieval",
          on: boundary.input.text({ from: "retrieval" }),
          run: (text) => {
            retrievalSeen.push(text);
            return {
              action: "rewrite",
              value: text.replace("private folded text", "safe folded text"),
              rewrite: { kind: "redact" },
            };
          },
        }),
        guardrail({
          id: "inspect-folded-instructions",
          on: boundary.input.instructions(),
          run: (text) => {
            instructionsSeen.push(text);
            return { action: "allow" };
          },
        }),
      ],
    });

    expect(retrievalSeen).toEqual([
      "## Retrieved Context (folded)\n" +
        "- [message.md/0] (score: 1.00) private folded text",
    ]);
    expect(instructionsSeen).toEqual(["Existing trusted suffix."]);
    expect(calls[0]?.system).toBeUndefined();
    expect(calls[0]?.systemBlocks).toBeUndefined();
    expect(calls[0]?.messages).toEqual([
      {
        role: "system",
        content:
          "## Retrieved Context (folded)\n" +
          "- [message.md/0] (score: 1.00) safe folded text\n\n" +
          "Existing trusted suffix.",
      },
      { role: "user", content: "Answer the question." },
    ]);
  });

  it("keeps messages-mode writeback identical across Core/SDK generate and stream", async () => {
    const makePrompt = () => {
      const docs = retriever({
        id: "parity-docs",
        namespace: "handbook",
        retrieve: async () => [
          {
            namespace: "handbook",
            source: { id: "parity.md" },
            chunkId: "0",
            content: "private parity text",
            metadata: {},
            score: 0.8,
          },
        ],
        context: { query: "parity" },
      });
      return prompt({
        id: "retrieval-messages-parity",
        use: [docs.asContext()],
        messages: () => [
          { role: "system" as const, content: "Trusted suffix." },
          { role: "user" as const, content: "Question." },
        ],
      });
    };
    const policy = () =>
      guardrail({
        id: "rewrite-retrieval-parity",
        on: boundary.input.text({ from: "retrieval" }),
        run: (text: string) => ({
          action: "rewrite" as const,
          value: text.replace("private parity text", "safe parity text"),
          rewrite: { kind: "redact" as const },
        }),
      });

    const coreCalls: CallArgs[] = [];
    const core = adapter(capturingRetrievalAdapter(coreCalls))({});
    await core.generate(makePrompt(), {
      model: "test-model",
      guardrails: [policy()],
    });
    const coreStream = await core.stream(makePrompt(), {
      model: "test-model",
      guardrails: [policy()],
    });
    await consumeTextStream(coreStream.textStream);
    await coreStream.completion;

    const fakeGenerate = fakeLoopRuntime({ loops: [[{ text: "done" }]] });
    await loopRuntimeAdapter(fakeGenerate.runtime).generate(makePrompt(), {
      model: "fake:test-model",
      guardrails: [policy()],
    });
    const fakeStream = fakeLoopRuntime({ streams: [["done"]] });
    const sdkStream = await loopRuntimeAdapter(fakeStream.runtime).stream(
      makePrompt(),
      { model: "fake:test-model", guardrails: [policy()] },
    );
    await sdkStream.completion();

    const expected = [
      {
        role: "system",
        content:
          "## Retrieved Context (parity)\n" +
          "- [parity.md/0] (score: 0.80) safe parity text\n\n" +
          "Trusted suffix.",
      },
      { role: "user", content: "Question." },
    ];
    expect(coreCalls.map((call) => call.messages)).toEqual([
      expected,
      expected,
    ]);
    expect(fakeGenerate.calls.runTextLoop[0]?.messages).toEqual(expected);
    expect(fakeStream.calls.runStream[0]?.messages).toEqual(expected);
    expect(coreCalls.every((call) => call.system === undefined)).toBe(true);
    expect(coreCalls.every((call) => call.systemBlocks === undefined)).toBe(
      true,
    );
    expect(fakeGenerate.calls.runTextLoop[0]?.system).toBeUndefined();
    expect(fakeGenerate.calls.runTextLoop[0]?.systemBlocks).toBeUndefined();
    expect(fakeStream.calls.runStream[0]?.system).toBeUndefined();
    expect(fakeStream.calls.runStream[0]?.systemBlocks).toBeUndefined();
    const providerRequests = [
      ...coreCalls,
      ...fakeGenerate.calls.runTextLoop,
      ...fakeStream.calls.runStream,
    ];
    expect(
      providerRequests.every(
        (request) =>
          systemIngressCarrierFor(request as unknown as ResolvedPrompt) ===
          undefined,
      ),
    ).toBe(true);
  });
});
