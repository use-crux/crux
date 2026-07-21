import { describe, expect, it } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import type { Message } from "../../src/generation/messages";
import type { CallArgs } from "../../src/adapter/types";
import { prompt } from "../../src/prompt/prompt";
import { isPolicyTerminal } from "../../src/safety/errors";
import { boundary, guardrail } from "../../src/safety";
import { skill } from "../../src/skill";
import { LOAD_SKILL_TOOL_NAME } from "../../src/skill/tools";
import {
  applySystemMessagePrefixPatch,
  createSystemMessagePrefixPatch,
} from "../../src/adapter/execution/system-prefix-patch";
import { scriptedSkillAdapter } from "./retrieval-input-safety-skill.fixture";
import "./retrieval-input-safety-skill-history.cases";
import "./retrieval-input-safety-skill-terminal.cases";

describe("retrieval input Safety — active system prefix amendments", () => {
  it("replaces only the expected prefix and preserves message identities", () => {
    const assistant = { role: "assistant", content: "tool requested" } as const;
    const tool = { role: "tool", content: "tool result" } as const;
    const messages: Message[] = [
      { role: "system", content: "safe retrieval\n\ntrusted suffix" },
      assistant,
      tool,
    ];

    const result = applySystemMessagePrefixPatch(
      messages,
      createSystemMessagePrefixPatch({
        targetMessageIndex: 0,
        expectedPrefix: "safe retrieval\n\n",
        replacementPrefix: "updated retrieval\n\n",
      }),
    );

    expect(result[0]).toEqual({
      role: "system",
      content: "updated retrieval\n\ntrusted suffix",
    });
    expect(result[1]).toBe(assistant);
    expect(result[2]).toBe(tool);
  });

  it("fails closed when the target no longer has the exact expected prefix", () => {
    const patch = createSystemMessagePrefixPatch({
      targetMessageIndex: 0,
      expectedPrefix: "safe retrieval\n\n",
      replacementPrefix: "updated retrieval\n\n",
    });

    expect(() =>
      applySystemMessagePrefixPatch(
        [{ role: "system", content: "changed elsewhere" }],
        patch,
      ),
    ).toThrowError(
      expect.objectContaining({
        name: "SafetyResultError",
        boundary: "model.instructions",
      }),
    );
    try {
      applySystemMessagePrefixPatch(
        [{ role: "system", content: "changed elsewhere" }],
        patch,
      );
    } catch (error) {
      expect(isPolicyTerminal(error)).toBe(true);
    }
  });

  it("inserts one system message only when the expected slot is absent", () => {
    const user = { role: "user", content: "hello" } as const;
    const patch = createSystemMessagePrefixPatch({
      targetMessageIndex: 0,
      expectedPrefix: undefined,
      replacementPrefix: "loaded skill",
    });

    const result = applySystemMessagePrefixPatch([user], patch);
    expect(result).toEqual([{ role: "system", content: "loaded skill" }, user]);
    expect(result[1]).toBe(user);
    expect(() =>
      applySystemMessagePrefixPatch(
        [{ role: "system", content: "already present" }, user],
        patch,
      ),
    ).toThrowError("system-message prefix patch target mismatch");
  });

  it("guards a freshly re-resolved standalone system before the second Core call", async () => {
    const calls: CallArgs[] = [];
    const instructionsSeen: string[] = [];
    const loadCall = {
      id: "load-system-skill",
      name: LOAD_SKILL_TOOL_NAME,
      args: { name: "system-skill" },
    };
    const answer = prompt({
      id: "guard-system-skill-amendment",
      system: "Base instructions.",
      prompt: "Question.",
      use: [
        skill.inline({
          id: "system-skill",
          description: "System amendment test",
          instructions: "RAW_SKILL_INSTRUCTIONS",
        }),
      ],
    });

    await adapter(
      scriptedSkillAdapter(
        [{ text: "loading", toolCalls: [loadCall] }, { text: "done" }],
        calls,
      ),
    )({}).generate(answer, {
      model: "test-model",
      maxSteps: 1,
      guardrails: [
        guardrail({
          id: "rewrite-loaded-system-skill",
          on: boundary.input.instructions(),
          run: (text) => {
            instructionsSeen.push(text);
            return text.includes("RAW_SKILL_INSTRUCTIONS")
              ? {
                  action: "rewrite",
                  value: text.replace(
                    "RAW_SKILL_INSTRUCTIONS",
                    "SAFE_SKILL_INSTRUCTIONS",
                  ),
                  rewrite: { kind: "redact" },
                }
              : { action: "allow" };
          },
        }),
      ],
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.system).toContain("SAFE_SKILL_INSTRUCTIONS");
    expect(calls[1]?.system).not.toContain("RAW_SKILL_INSTRUCTIONS");
    expect(
      instructionsSeen.filter((text) =>
        text.includes("RAW_SKILL_INSTRUCTIONS"),
      ),
    ).toHaveLength(1);
    expect(calls[1]?.systemBlocks).toBeUndefined();

    const fake = fakeLoopRuntime({
      loops: [[{ text: "loading", toolCalls: [loadCall] }, { text: "done" }]],
    });
    const sdkResult = await loopRuntimeAdapter(fake.runtime).generate(answer, {
      model: "fake:test-model",
      maxSteps: 1,
      guardrails: [
        guardrail({
          id: "rewrite-loaded-system-skill-sdk",
          on: boundary.input.instructions(),
          run: (text) =>
            text.includes("RAW_SKILL_INSTRUCTIONS")
              ? {
                  action: "rewrite",
                  value: text.replace(
                    "RAW_SKILL_INSTRUCTIONS",
                    "SAFE_SKILL_INSTRUCTIONS",
                  ),
                  rewrite: { kind: "redact" },
                }
              : { action: "allow" },
        }),
      ],
    });
    expect(sdkResult.raw?.system).toContain("SAFE_SKILL_INSTRUCTIONS");
    expect(sdkResult.raw?.system).not.toContain("RAW_SKILL_INSTRUCTIONS");
  });
});
