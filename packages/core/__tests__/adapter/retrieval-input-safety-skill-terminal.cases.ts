/** Terminal post-skill input Safety cases for both loop ownership models. */

import { describe, expect, it } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import type { CallArgs } from "../../src/adapter/types";
import { prompt } from "../../src/prompt/prompt";
import { boundary, guardrail, GuardrailBlockedError } from "../../src/safety";
import { skill } from "../../src/skill";
import { LOAD_SKILL_TOOL_NAME } from "../../src/skill/tools";
import { scriptedSkillAdapter } from "./retrieval-input-safety-skill.fixture";

describe("retrieval input Safety — terminal skill amendments", () => {
  it("blocks before a second Core or SDK model step", async () => {
    const calls: CallArgs[] = [];
    const loadCall = {
      id: "load-blocked-skill",
      name: LOAD_SKILL_TOOL_NAME,
      args: { name: "blocked-skill" },
    };
    const script = [
      { text: "loading", toolCalls: [loadCall] },
      { text: "must not run" },
    ];

    await expect(
      adapter(scriptedSkillAdapter(script, calls))({}).generate(
        blockedPrompt(),
        {
          model: "test-model",
          maxSteps: 1,
          guardrails: [blockingPolicy()],
        },
      ),
    ).rejects.toBeInstanceOf(GuardrailBlockedError);

    let sdkOutputSteps = 0;
    const fake = fakeLoopRuntime({ loops: [script] });
    await expect(
      loopRuntimeAdapter(fake.runtime).generate(blockedPrompt(), {
        model: "fake:test-model",
        maxSteps: 1,
        guardrails: [
          blockingPolicy(),
          guardrail({
            id: "count-sdk-output-steps",
            on: boundary.output.text(),
            run: (text) => {
              sdkOutputSteps++;
              return { action: "allow", value: text };
            },
          }),
        ],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError);

    expect(calls).toHaveLength(1);
    expect(sdkOutputSteps).toBe(1);
  });
});

function blockedPrompt() {
  return prompt({
    id: "blocked-skill-amendment",
    prompt: "Question.",
    use: [
      skill.inline({
        id: "blocked-skill",
        description: "Blocked amendment test",
        instructions: "BLOCK_THIS_SKILL",
      }),
    ],
  });
}

function blockingPolicy() {
  return guardrail({
    id: "block-loaded-skill",
    on: boundary.input.instructions(),
    run: (text: string) =>
      text.includes("BLOCK_THIS_SKILL")
        ? { action: "block" as const, reason: "unsafe skill" }
        : { action: "allow" as const },
  });
}
