import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adapter,
  config,
  effect,
  loopRuntimeAdapter,
  offload,
  prompt,
  tool,
  type AdapterResponse,
  type AdapterSpec,
} from "../src";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../src/observability";
import { node } from "../src/runtime/public";
import { inMemoryRuntimeStore } from "../src/runtime/adapters/memory";
import { resetEffectDefinitionsForTesting } from "../src/effect/define-effect";
import { resetHooks } from "../src/runtime/runtime";
import { fakeLoopRuntime } from "../src/adapter/testing";
import { inMemoryRecordStore } from "../src/storage";

afterEach(() => {
  resetEffectDefinitionsForTesting();
  resetObservabilityRuntime();
  resetHooks();
});

describe("Effect request journal linkage", () => {
  it("links sealed request and canonical tool output facts without duplicating plans", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const store = inMemoryRuntimeStore();
    let effectReceiptId = "";
    const update = effect(
      "customer.journal-update",
      async (_input: undefined, context) => {
        effectReceiptId = context.receiptId;
        return "updated";
      },
    );
    const applyUpdate = tool({
      description: "Apply the customer update.",
      input: z.object({}),
      execute: async () => {
        await update();
        return { canonical: "complete-record" };
      },
      toModelOutput: () => ({ type: "text", value: "short summary" }),
    });
    const request = prompt({
      id: "effect-journal-linkage",
      prompt: "Apply the update.",
      tools: { applyUpdate },
    });
    let calls = 0;
    const spec: AdapterSpec<object, object> = {
      providerId: "effect-journal-test",
      async call() {
        calls += 1;
        return {
          raw: {},
          extracted: response(
            calls === 1 ? "" : "done",
            calls === 1
              ? [{ id: "tool-call-1", name: "applyUpdate", args: {} }]
              : undefined,
          ),
        };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (messages, assistant, results) => [
        ...messages,
        {
          role: "assistant",
          content: assistant.text,
          metadata: { toolCalls: assistant.toolCalls },
        },
        ...results.map((result) => ({
          role: "tool" as const,
          content: result.content,
          metadata: {
            toolCallId: result.toolCallId,
            toolName: result.name,
          },
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
      const result = await adapter(spec)({}).generate(request, {
        model: "model-1",
        maxSteps: 2,
      });
      await observe.flush();
      const firstRequest = result.steps[0]!.request!;
      const inspection = await firstRequest.inspect();
      const stored = await store.effects.getReceipt(effectReceiptId, {
        namespace: "tenant-a",
      });
      const receipt = stored?.receipt as typeof stored.receipt & {
        readonly requestId?: string;
        readonly requestPlanRef?: {
          readonly kind: string;
          readonly id: string;
        };
        readonly requestRetryCount?: number;
        readonly toolOutcomeRef?: {
          readonly kind: string;
          readonly id: string;
        };
      };

      expect(receipt).toMatchObject({
        requestId: firstRequest.id,
        requestPlanRef: { kind: "artifact", id: expect.any(String) },
        requestRetryCount: inspection.retryCount,
        toolCallId: "tool-call-1",
        toolOutcomeRef: { kind: "artifact", id: expect.any(String) },
      });
      const linkedOutput = transport.records.find(
        (record) =>
          record.type === "artifact" &&
          record.artifactId === receipt.toolOutcomeRef?.id,
      );
      expect(linkedOutput).toMatchObject({
        kind: "tool.result",
        preview: { canonical: "complete-record" },
        attributes: { resultKind: "raw" },
      });
      expect(JSON.stringify(receipt)).not.toContain("modelOutput");

      const planArtifacts = transport.records.filter(
        (record) =>
          record.type === "artifact" && record.kind === "request.plan",
      );
      expect(planArtifacts).toHaveLength(result.steps.length * 2);
      expect(
        planArtifacts.filter(
          (record) =>
            record.type === "artifact" &&
            record.artifactId === receipt.requestPlanRef?.id,
        ),
      ).toHaveLength(1);
    } finally {
      runtime.dispose();
    }
  });

  it("links canonical tool output from an SDK-owned loop", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const store = inMemoryRuntimeStore();
    let receiptId = "";
    let failedReceiptId = "";
    const update = effect(
      "customer.sdk-journal-update",
      async (_input: undefined, context) => {
        receiptId = context.receiptId;
        return "updated";
      },
    );
    const rejectedUpdate = effect(
      "customer.sdk-rejected-update",
      async (_input: undefined, context) => {
        failedReceiptId = context.receiptId;
        throw new Error("update rejected");
      },
    );
    const applyUpdate = tool({
      description: "Apply the customer update.",
      input: z.object({}),
      execute: async () => {
        await update();
        await rejectedUpdate().catch(() => undefined);
        return offload({ canonical: "sdk-complete-record" });
      },
    });
    const request = prompt({
      id: "effect-sdk-journal-linkage",
      prompt: "Apply the update.",
      tools: { applyUpdate },
    });
    const fake = fakeLoopRuntime({
      loops: [
        [
          {
            text: "",
            transportRetries: 2,
            toolCalls: [
              { id: "sdk-tool-call-1", name: "applyUpdate", args: {} },
            ],
          },
          { text: "done" },
        ],
      ],
    });
    const runtime = config({
      runtime: node({
        namespace: "tenant-a",
        store,
        autoStartMaintenance: false,
      }),
      storage: { records: inMemoryRecordStore() },
    });

    try {
      const result = await loopRuntimeAdapter(fake.runtime).generate(request, {
        model: "fake:model-1",
        maxSteps: 2,
      });
      await observe.flush();
      const stored = await store.effects.getReceipt(receiptId, {
        namespace: "tenant-a",
      });
      expect(stored?.receipt).toMatchObject({
        requestId: result.steps[0]?.request?.id,
        requestRetryCount: 2,
        toolCallId: "sdk-tool-call-1",
        toolOutcomeRef: { kind: "artifact", id: expect.any(String) },
      });
      await expect(
        store.effects.getReceipt(failedReceiptId, {
          namespace: "tenant-a",
        }),
      ).resolves.toMatchObject({
        receipt: { requestRetryCount: 2 },
      });
      const linkedOutput = transport.records.find(
        (record) =>
          record.type === "artifact" &&
          record.artifactId === stored?.receipt.toolOutcomeRef?.id,
      );
      expect(linkedOutput).toMatchObject({
        preview: { canonical: "sdk-complete-record" },
        attributes: { resultKind: "raw" },
      });
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
    transportRetries: 2,
  };
}
