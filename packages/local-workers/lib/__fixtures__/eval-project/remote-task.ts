import { attachEvalTaskDescriptorForInternalUse } from "@use-crux/core/eval/internal/task";
import {
  createCruxRunId,
  createCruxSpanId,
  createCruxTraceId,
} from "@use-crux/core/observability";

export const remoteTask = attachEvalTaskDescriptorForInternalUse(
  async (input: { question: string }) => input.question,
  {
    _tag: "CruxEvalTaskDescriptor",
    operation: "generate",
    adapterId: "ai-sdk",
    capabilities: [],
    requiredHostCapabilities: ["record-store"],
    defaults: {},
    overrideKeys: [],
    projectIdentity: () => ({
      reusable: true,
      fingerprintMaterial: { adapter: "remote-fixture-v1" },
    }),
    execute: async (input) => ({
      output: (input as { question: string }).question,
    }),
    projectOutput: (result) => result.output,
    projectResponse: (result) => ({
      runId: createCruxRunId(),
      _meta: {
        traceId: createCruxTraceId(),
        spanId: createCruxSpanId(),
      },
      content: [],
      text: result.output,
      object: result.output,
      steps: [],
      finalStep: {
        content: [],
        text: result.output,
        finishReason: "stop",
        responseId: "remote-fixture-response",
        modelId: "remote-fixture-model",
        warnings: [],
      },
      messages: [],
      warnings: [],
    }),
  },
);
