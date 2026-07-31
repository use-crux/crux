/** Delivery-source selection for private resolved retrieval provenance. */

import { describe, expect, it } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import type { ExecutorGenerateOptions } from "../../src/adapter/define-executor";
import type { CallArgs } from "../../src/adapter/types";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import type { Message } from "../../src/generation/messages";
import { prompt } from "../../src/prompt/prompt";
import { retriever } from "../../src/retrieval";
import { boundary, guardrail } from "../../src/safety";
import { capturingRetrievalAdapter } from "./retrieval-input-safety.fixture";

describe("resolved retrieval delivery selection", () => {
  it("does not apply a discarded messages carrier to explicit Core history", async () => {
    const calls: CallArgs[] = [];
    const retrievalSeen: string[] = [];
    const instructionsSeen: string[] = [];
    const history: Message[] = [
      { role: "system", content: "Explicit trusted history." },
      { role: "user", content: "Continue." },
    ];

    await adapter(capturingRetrievalAdapter(calls))({}).generate(
      messagesPrompt(),
      {
        model: "test-model",
        messages: history,
        guardrails: selectionPolicies(retrievalSeen, instructionsSeen),
      },
    );

    expect(retrievalSeen).toEqual([]);
    expect(instructionsSeen).toEqual(["Explicit trusted history."]);
    expect(calls[0]?.messages).toEqual(history);
  });

  it("treats empty call-site history as an explicit source", async () => {
    const calls: CallArgs[] = [];
    const retrievalSeen: string[] = [];

    await adapter(capturingRetrievalAdapter(calls))({}).generate(
      messagesPrompt(),
      {
        model: "test-model",
        messages: [],
        guardrails: selectionPolicies(retrievalSeen, []),
      },
    );

    expect(retrievalSeen).toEqual([]);
    expect(calls[0]?.messages).toEqual([]);
  });

  it("keeps standalone system provenance alongside explicit history", async () => {
    const calls: CallArgs[] = [];
    const retrievalSeen: string[] = [];
    const docs = docsRetriever("system-selection-docs");
    const answer = prompt({
      id: "system-selection",
      system: "Trusted system.",
      use: [docs.asContext()],
      prompt: "Discarded prompt.",
    });
    const history: Message[] = [{ role: "user", content: "Explicit turn." }];

    await adapter(capturingRetrievalAdapter(calls))({}).generate(answer, {
      model: "test-model",
      messages: history,
      guardrails: selectionPolicies(retrievalSeen, []),
    });

    expect(retrievalSeen).toHaveLength(1);
    expect(calls[0]?.system).toContain("safe selected retrieval");
    expect(calls[0]?.messages).toEqual(history);
  });

  it("does not apply a discarded carrier when SDK-native history is selected", async () => {
    const fake = fakeLoopRuntime({ loops: [[{ text: "done" }]] });
    const retrievalSeen: string[] = [];
    const nativeMessages = [
      {
        role: "system",
        content: "Native trusted history.",
        providerOptions: { test: { cache: true } },
      },
      { role: "user", content: "Continue natively." },
    ] as const;
    const options: ExecutorGenerateOptions<string> & {
      readonly nativeMessages: readonly unknown[];
    } = {
      model: "fake:test-model",
      messages: [
        { role: "system", content: "Native trusted history." },
        { role: "user", content: "Continue natively." },
      ],
      nativeMessages,
      guardrails: selectionPolicies(retrievalSeen, []),
    };

    await loopRuntimeAdapter(fake.runtime).generate(messagesPrompt(), options);

    expect(retrievalSeen).toEqual([]);
    expect(fake.calls.runTextLoop[0]?.nativeMessages).toBe(nativeMessages);
  });

  it("does not fall back to resolved messages when native history has no canonical copy", async () => {
    const fake = fakeLoopRuntime({ loops: [[{ text: "done" }]] });
    const retrievalSeen: string[] = [];
    const nativeMessages = [
      { role: "user", content: "Native-only history." },
    ] as const;
    const options: ExecutorGenerateOptions<string> & {
      readonly nativeMessages: readonly unknown[];
    } = {
      model: "fake:test-model",
      nativeMessages,
      guardrails: selectionPolicies(retrievalSeen, []),
    };

    await loopRuntimeAdapter(fake.runtime).generate(messagesPrompt(), options);

    expect(retrievalSeen).toEqual([]);
    expect(fake.calls.runTextLoop[0]?.nativeMessages).toBe(nativeMessages);
    expect(fake.calls.runTextLoop[0]?.messages).toBeUndefined();
  });
});

function selectionPolicies(
  retrievalSeen: string[],
  instructionsSeen: string[],
) {
  return [
    guardrail({
      id: "selected-retrieval",
      on: boundary.input.text({ from: "retrieval" }),
      run: (text) => {
        retrievalSeen.push(text);
        return {
          action: "rewrite" as const,
          value: text.replace(
            "private selected retrieval",
            "safe selected retrieval",
          ),
          rewrite: { kind: "redact" as const },
        };
      },
    }),
    guardrail({
      id: "selected-instructions",
      on: boundary.input.instructions(),
      run: (text) => {
        instructionsSeen.push(text);
        return { action: "allow" as const };
      },
    }),
  ];
}

function messagesPrompt() {
  return prompt({
    id: "messages-selection",
    use: [docsRetriever("messages-selection-docs").asContext()],
    messages: () => [
      { role: "system" as const, content: "Resolved trusted suffix." },
      { role: "user" as const, content: "Resolved question." },
    ],
  });
}

function docsRetriever(id: string) {
  return retriever({
    id,
    namespace: "handbook",
    retrieve: async () => [
      {
        namespace: "handbook",
        source: { id: "selected.md" },
        chunkId: "0",
        content: "private selected retrieval",
        metadata: {},
        score: 1,
      },
    ],
    context: { query: "selected" },
  });
}
