import { attachEvalTaskDescriptorForInternalUse } from "../../../../src/eval/internal/task";
import { z } from "zod";

export const inputSchema = z.object({ question: z.string() });

export const task = attachEvalTaskDescriptorForInternalUse(
  async (input: { question: string }) => input.question,
  {
    _tag: "CruxEvalTaskDescriptor",
    operation: "generate",
    adapterId: "ai-sdk",
    inputSchema,
    capabilities: [],
    defaults: {},
    overrideKeys: [],
    projectIdentity: () => ({
      reusable: true,
      fingerprintMaterial: { fixture: "node-run-v1" },
    }),
    execute: async (input) => ({ output: (input as { question: string }).question }),
    projectOutput: (result) => result.output,
    projectResponse: (result) => ({
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
