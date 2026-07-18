import { evaluate } from "@use-crux/core/eval";
import { attachEvalTaskDescriptorForInternalUse } from "@use-crux/core/eval/internal/task";
import { createCruxRunId } from "@use-crux/core/observability";

const task = attachEvalTaskDescriptorForInternalUse(
  async (input: { message: string }) => input.message,
  {
    _tag: "CruxEvalTaskDescriptor",
    operation: "generate",
    adapterId: "ai-sdk",
    capabilities: [],
    defaults: {},
    overrideKeys: [],
    projectIdentity: () => ({
      reusable: true,
      fingerprintMaterial: { fixture: "runtime-eval" },
    }),
    execute: async (input) => ({
      output: (input as { message: string }).message,
    }),
    projectOutput: (result) => result.output,
    projectResponse: (result) => ({
      runId: createCruxRunId(),
      content: [],
      text: result.output,
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

export default evaluate({
  id: "support",
  task,
  cases: [{ id: "refund", input: { message: "refund" } }],
});
