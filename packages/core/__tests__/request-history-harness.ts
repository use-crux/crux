import { vi } from "vitest";
import {
  adapter,
  loopRuntimeAdapter,
  type AdapterResponse,
  type AdapterSpec,
  type CallArgs,
  type LoopRuntimePort,
  type Message,
} from "../src";

export function historyResponse(text: string): AdapterResponse {
  return {
    text,
    toolCalls: undefined,
    usage: undefined,
    finishReason: "stop",
    responseId: "response-1",
    actualModelId: "model-1",
  };
}

export const managedHistoryMessages: Message[] = [
  { role: "user", content: "old question with detailed account context" },
  { role: "assistant", content: "old answer with detailed preferences" },
  { role: "user", content: "middle question with more account context" },
  { role: "assistant", content: "middle answer with more preferences" },
  { role: "user", content: "new question" },
  { role: "assistant", content: "new answer" },
];

export function historyAdapter() {
  const requests: CallArgs[] = [];
  const call = vi.fn(async (_client: object, args: CallArgs) => {
    requests.push(args);
    return {
      raw: { text: "done" },
      extracted: historyResponse("done"),
    };
  });
  const spec: AdapterSpec<object, { readonly text: string }> = {
    providerId: "history-test",
    capacity: () => ({
      contextWindow: 32_768,
      defaultOutputReserve: 256,
      countingConfidence: "estimated",
    }),
    call,
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };
  return { runtime: adapter(spec)({}), requests, call };
}

export function sdkHistoryAdapter() {
  const requests: Message[][] = [];
  const providerCalls = vi.fn();
  const runtime: LoopRuntimePort<string, object> = {
    id: "history-sdk-test",
    capabilities: { requestPlanning: "per-step" },
    capacity: () => ({
      contextWindow: 32_768,
      defaultOutputReserve: 256,
      countingConfidence: "estimated",
    }),
    describeModel: (model) => ({
      provider: "history-sdk-test",
      modelId: model,
    }),
    mapSettings: (settings) => ({ ...settings }),
    async runTextLoop(request) {
      const planned = await request.planStep!({
        model: request.model,
        modelInfo: request.modelInfo,
        system: request.system,
        systemBlocks: request.systemBlocks,
        messages: request.messages ?? [],
      });
      requests.push([...planned.messages]);
      providerCalls();
      return {
        status: "complete",
        raw: {},
        response: historyResponse("done"),
        messages: [
          ...planned.messages,
          { role: "assistant", content: "done" },
        ],
        steps: 1,
        stepFacts: [
          {
            request: planned.receipt,
            content: [{ type: "text", text: "done" }],
            finishReason: "stop",
            responseId: "response-1",
            modelId: "model-1",
          },
        ],
        meta: {},
      };
    },
    async runStructuredAttempt() {
      throw new Error("not used");
    },
    async runStream() {
      throw new Error("not used");
    },
  };
  return {
    runtime: loopRuntimeAdapter(runtime),
    requests,
    providerCalls,
  };
}
