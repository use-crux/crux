/** Active-history skill amendments exercised through both loop dialects. */

import { describe, expect, it } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import type { CallArgs } from "../../src/adapter/types";
import type { Message } from "../../src/generation/messages";
import { prompt } from "../../src/prompt/prompt";
import { retriever } from "../../src/retrieval";
import { boundary, guardrail } from "../../src/safety";
import { skill } from "../../src/skill";
import { LOAD_SKILL_TOOL_NAME } from "../../src/skill/tools";
import { scriptedSkillAdapter } from "./retrieval-input-safety-skill.fixture";

const loadCall = {
  id: "load-history-skill",
  name: LOAD_SKILL_TOOL_NAME,
  args: { name: "history-skill" },
};

describe("retrieval input Safety — skill amendments in active history", () => {
  it("patches only a resolved system prefix and preserves every active turn", async () => {
    const coreCalls: CallArgs[] = [];
    const instructionRuns: string[] = [];
    const retrievalRuns: string[] = [];
    const guardrails = policies(instructionRuns, retrievalRuns);

    await adapter(
      scriptedSkillAdapter(
        [{ text: "loading", toolCalls: [loadCall] }, { text: "done" }],
        coreCalls,
      ),
    )({}).generate(historyPrompt(), {
      model: "test-model",
      maxSteps: 1,
      guardrails,
    });

    const fake = fakeLoopRuntime({
      loops: [[{ text: "loading", toolCalls: [loadCall] }, { text: "done" }]],
    });
    const sdkResult = await loopRuntimeAdapter(fake.runtime).generate(
      historyPrompt(),
      {
        model: "fake:test-model",
        maxSteps: 1,
        guardrails: policies([], []),
        observer: {
          onStepEnd: () => ({
            kind: "amend",
            system: "must not become a parallel system",
            activeTools: [],
          }),
        },
      },
    );

    expect(coreCalls).toHaveLength(2);
    assertPatchedHistory(coreCalls[1]?.messages ?? []);
    assertPatchedHistory(sdkResult.messages);
    expect(sdkResult.raw?.system).toBeUndefined();
    expect(retrievalRuns).toHaveLength(2);
    expect(
      instructionRuns.filter((text) => text.includes("RAW_HISTORY_SKILL")),
    ).toHaveLength(1);
  });

  it("injects only a newly loaded skill into explicit history", async () => {
    const calls: CallArgs[] = [];
    const retrievalRuns: string[] = [];
    const instructionRuns: string[] = [];
    const explicit: Message[] = [
      { role: "system", content: "Explicit trusted suffix." },
      { role: "user", content: "Explicit question." },
    ];

    await adapter(
      scriptedSkillAdapter(
        [{ text: "loading", toolCalls: [loadCall] }, { text: "done" }],
        calls,
      ),
    )({}).generate(historyPrompt(), {
      model: "test-model",
      maxSteps: 1,
      messages: explicit,
      guardrails: policies(instructionRuns, retrievalRuns),
    });

    const fake = fakeLoopRuntime({
      loops: [[{ text: "loading", toolCalls: [loadCall] }, { text: "done" }]],
    });
    const sdkResult = await loopRuntimeAdapter(fake.runtime).generate(
      historyPrompt(),
      {
        model: "fake:test-model",
        maxSteps: 1,
        messages: explicit,
        guardrails: policies([], []),
      },
    );

    expect(calls).toHaveLength(2);
    const second = calls[1]?.messages ?? [];
    const expectedSystem = {
      role: "system",
      content:
        "## Skill: history-skill\n\nSAFE_HISTORY_SKILL\n\n" +
        "Explicit trusted suffix.",
    } as const;
    expect(second[0]).toEqual(expectedSystem);
    expect(sdkResult.messages[0]).toEqual(expectedSystem);
    expect(second).toContainEqual({
      role: "user",
      content: "Explicit question.",
    });
    expect(JSON.stringify(second)).not.toContain("Resolved-only question.");
    expect(JSON.stringify(second)).not.toContain("private fresh retrieval");
    expect(JSON.stringify(sdkResult.messages)).not.toContain(
      "private fresh retrieval",
    );
    expect(retrievalRuns).toEqual([]);
    expect(instructionRuns).toEqual([
      "Explicit trusted suffix.",
      "## Skill: history-skill\n\nRAW_HISTORY_SKILL",
    ]);
  });
});

function historyPrompt() {
  const docs = retriever({
    id: "skill-history-docs",
    namespace: "handbook",
    retrieve: async () => [
      {
        namespace: "handbook",
        source: { id: "skill.md" },
        chunkId: "0",
        content: "private fresh retrieval",
        metadata: {},
        score: 1,
      },
    ],
    context: { query: "skill" },
  });
  return prompt({
    id: "guard-history-skill-amendment",
    use: [
      docs.asContext(),
      skill.inline({
        id: "history-skill",
        description: "History amendment test",
        instructions: "RAW_HISTORY_SKILL",
      }),
    ],
    messages: () => [
      { role: "system" as const, content: "Trusted history suffix." },
      { role: "user" as const, content: "Resolved-only question." },
    ],
  });
}

function policies(instructionsSeen: string[], retrievalSeen: string[]) {
  return [
    guardrail({
      id: "rewrite-history-instructions",
      on: boundary.input.instructions(),
      run: (text) => {
        instructionsSeen.push(text);
        return text.includes("RAW_HISTORY_SKILL")
          ? {
              action: "rewrite" as const,
              value: text.replace("RAW_HISTORY_SKILL", "SAFE_HISTORY_SKILL"),
              rewrite: { kind: "redact" as const },
            }
          : { action: "allow" as const };
      },
    }),
    guardrail({
      id: "rewrite-history-retrieval",
      on: boundary.input.text({ from: "retrieval" }),
      run: (text) => {
        retrievalSeen.push(text);
        return {
          action: "rewrite" as const,
          value: text.replace("private fresh retrieval", "safe retrieval"),
          rewrite: { kind: "redact" as const },
        };
      },
    }),
  ];
}

function assertPatchedHistory(messages: readonly Message[]): void {
  expect(messages[0]?.role).toBe("system");
  expect(messages[0]?.content).toContain("SAFE_HISTORY_SKILL");
  expect(messages[0]?.content).toContain("safe retrieval");
  expect(messages[0]?.content).toContain("Trusted history suffix.");
  expect(messages[0]?.content).not.toContain("RAW_HISTORY_SKILL");
  expect(messages).toContainEqual(
    expect.objectContaining({ role: "assistant", content: "loading" }),
  );
  expect(messages).toContainEqual(
    expect.objectContaining({
      role: "tool",
      metadata: expect.objectContaining({ toolCallId: loadCall.id }),
    }),
  );
}
