import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adapter,
  config,
  effect,
  prompt,
  tool,
  type AdapterResponse,
  type AdapterSpec,
} from "../src";
import { resetEffectDefinitionsForTesting } from "../src/effect/define-effect";
import { inMemoryRuntimeStore } from "../src/runtime/adapters/memory";
import { node } from "../src/runtime/public";
import { resetHooks } from "../src/runtime/runtime";
import type { ThreadHistoryEntry } from "../src/prompt";
import { ThreadCommitError } from "../src/thread";

afterEach(() => {
  resetEffectDefinitionsForTesting();
  resetHooks();
});

describe("Effect settlement before Thread publication", () => {
  it("keeps the durable settlement when later publication rejects the turn", async () => {
    const store = inMemoryRuntimeStore();
    let receiptId = "";
    let providerSuccesses = 0;
    let publicationObservedOutcome: string | undefined;
    const publish = effect(
      "customer.publish-before-thread",
      async (_input: undefined, context) => {
        receiptId = context.receiptId;
        return "published";
      },
    );
    const publishTool = tool({
      description: "Publish the durable customer change.",
      input: z.object({}),
      execute: async () => {
        await publish();
        return "effect complete";
      },
    });
    const conversation = {
      _tag: "Thread",
      id: "effect-publication-ordering",
      readHistory: async () => ({
        revision: "revision-1",
        messages: [],
        messageIds: [],
      }),
      validateRevision: async () => undefined,
      commitTurn: async () => {
        publicationObservedOutcome = (
          await store.effects.getReceipt(receiptId, { namespace: "tenant-a" })
        )?.receipt.outcome;
        throw new Error("publication failed");
      },
    } satisfies ThreadHistoryEntry;
    const request = prompt({
      id: "effect-publication-ordering-request",
      use: [conversation],
      prompt: "Publish the customer change.",
      tools: { publishTool },
      hooks: {
        onGenerate: () => {
          providerSuccesses += 1;
        },
      },
    });
    let calls = 0;
    const spec: AdapterSpec<object, object> = {
      providerId: "effect-publication-ordering-test",
      async call() {
        calls += 1;
        return {
          raw: {},
          extracted: response(
            calls === 1 ? "" : "provider accepted",
            calls === 1
              ? [{ id: "tool-call-1", name: "publishTool", args: {} }]
              : undefined,
          ),
        };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (messages, assistant, results) => [
        ...messages,
        { role: "assistant", content: assistant.text },
        ...results.map((result) => ({
          role: "tool" as const,
          content: result.content,
          metadata: { toolCallId: result.toolCallId, toolName: result.name },
        })),
      ],
      mapSettings: () => ({}),
    };
    const runtime = config({
      runtime: node({
        namespace: "tenant-a",
        store,
        autoStartMaintenance: false,
      }),
    });

    try {
      await expect(
        adapter(spec)({}).generate(request, {
          model: "model-1",
          maxSteps: 2,
        }),
      ).rejects.toBeInstanceOf(ThreadCommitError);
      expect(publicationObservedOutcome).toBe("succeeded");
      expect(providerSuccesses).toBe(0);
      await expect(
        store.effects.getReceipt(receiptId, {
          namespace: "tenant-a",
        }),
      ).resolves.toMatchObject({ receipt: { outcome: "succeeded" } });
    } finally {
      runtime.dispose();
    }
  });
});

function response(
  text: string,
  toolCalls?: Array<{ id: string; name: string; args: unknown }>,
): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: undefined,
    finishReason: toolCalls ? "tool_calls" : "stop",
    responseId: undefined,
    actualModelId: undefined,
  };
}
