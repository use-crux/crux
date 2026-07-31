import { beforeEach, describe, expect, it, vi } from "vitest";
import { createToolLifecycle } from "../src/adapter/tool/index";
import type { AdapterResponse } from "../src/adapter/types";
import {
  effect,
  rollbackOnError,
} from "../src/effect/index";
import type { EffectScopeRef } from "../src/effect/index";
import { resetEffectDefinitionsForTesting } from "../src/effect/define-effect";
import { flow } from "../src/flow/index";
import type { ResolvedPrompt } from "../src/resolver/types";

function resolvedWith(
  partial: Partial<ResolvedPrompt>,
): ResolvedPrompt {
  return { settings: {}, ...partial } as ResolvedPrompt;
}

function toolCallResponse(): AdapterResponse {
  return {
    text: "",
    toolCalls: [
      {
        id: "tool-call-ancestry",
        name: "apply-update",
        args: {},
      },
    ],
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      inputTokenDetails: {},
      outputTokenDetails: {},
    },
    finishReason: "tool_calls",
    responseId: undefined,
    actualModelId: undefined,
  };
}

describe("effect scope ancestry", () => {
  beforeEach(() => {
    resetEffectDefinitionsForTesting();
  });

  it("attaches an immediate flow step to its nearest effect boundary", async () => {
    let executionScope: EffectScopeRef | undefined;
    let executionKey: string | undefined;
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "ancestry.flow-update",
      async (_input, context) => {
        executionScope = context.scope;
        executionKey = context.idempotencyKey;
      },
      { recover: recovery },
    );
    const updateFlow = flow("effect-ancestry", async (scope) =>
      scope.step("apply", () => update.run()),
    );
    let boundaryRef: EffectScopeRef | undefined;

    await rollbackOnError(async (scope) => {
      boundaryRef = scope.ref;
      const result = await updateFlow.run({
        flowId: "flow-ancestry",
      });
      expect(result.status).toBe("completed");
      await scope.rollback();
    });

    expect(executionScope).toEqual(boundaryRef);
    expect(executionKey).toMatch(
      /flow-step\[flow-step:\d+\]/,
    );
    expect(recovery).toHaveBeenCalledOnce();
  });

  it("observes tool ancestry through the real tool lifecycle", async () => {
    let executionScope: EffectScopeRef | undefined;
    let executionKey: string | undefined;
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "ancestry.tool-update",
      async (_input, context) => {
        executionScope = context.scope;
        executionKey = context.idempotencyKey;
      },
      { recover: recovery },
    );
    const lifecycle = createToolLifecycle({
      regime: "core",
      resolved: resolvedWith({
        tools: {
          "apply-update": {
            description: "Apply an update",
            execute: async () => update.run(),
          },
        },
      }),
      promptId: "effect-ancestry",
    });
    let boundaryRef: EffectScopeRef | undefined;

    await rollbackOnError(async (scope) => {
      boundaryRef = scope.ref;
      const round = await lifecycle.executeRound(
        toolCallResponse(),
        [{ role: "user", content: "apply it" }],
      );
      expect(round.kind).toBe("completed");
      await scope.rollback();
    });

    expect(executionScope).toEqual(boundaryRef);
    expect(executionKey).toMatch(/tool\[tool:\d+\]/);
    expect(recovery).toHaveBeenCalledOnce();
  });
});
