import { evaluate } from "../../../../../src/eval";
import { attachEvalTaskDescriptorForInternalUse } from "../../../../../src/eval/internal/task";

const inlineTask = attachEvalTaskDescriptorForInternalUse(
  async (input: { question: string }) => input.question,
  {
    _tag: "CruxEvalTaskDescriptor",
    operation: "generate",
    adapterId: "ai-sdk",
    capabilities: [],
    defaults: {},
    overrideKeys: [],
    projectIdentity: () => ({
      reusable: true,
      fingerprintMaterial: { fixture: "inline-task" },
    }),
    estimateCost: () => ({ kind: "none" }),
    execute: async (input) => ({
      output: (input as { question: string }).question,
    }),
    projectOutput: (result) => result.output,
    projectResponse: (result) => ({
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
  id: "inline-task",
  task: inlineTask,
  cases: [{ id: "inline-task-case", input: { question: "run" } }],
});
