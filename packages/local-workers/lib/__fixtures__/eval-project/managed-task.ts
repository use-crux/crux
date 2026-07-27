import { attachEvalTaskDescriptorForInternalUse } from "@use-crux/core/eval/internal/task";
import {
  createCruxRunId,
  createCruxSpanId,
  createCruxTraceId,
} from "@use-crux/core/observability";
import { z } from "zod";

export const inputSchema = z.object({ question: z.string() });

export const managedTask = attachEvalTaskDescriptorForInternalUse(
  async (input: { question: string }) => input.question,
  {
    _tag: "CruxEvalTaskDescriptor",
    identityEpoch: 2,
    operation: "generate",
    adapterId: "ai-sdk",
    inputSchema,
    capabilities: [],
    defaults: {},
    overrideKeys: [],
    projectIdentity: () => ({
      reusable: true,
      fingerprintMaterial: { adapter: "fixture-v1" },
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
        responseId: "fixture-response",
        modelId: "fixture-model",
        warnings: [],
      },
      messages: [],
      warnings: [],
    }),
  },
);
