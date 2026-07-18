import { evaluate } from "../../../../../src/eval";
import { attachEvalTaskDescriptorForInternalUse } from "../../../../../src/eval/internal/task";
import { task } from "../task";

const replacement = attachEvalTaskDescriptorForInternalUse(
  async (input: { question: string }) => input.question,
  {
    _tag: "CruxEvalTaskDescriptor",
    operation: "generate",
    adapterId: "ai-sdk",
    callContractFingerprint: "fixture.generate.call.v1",
    capabilities: [],
    defaults: {},
    overrideKeys: [],
    projectIdentity: () => ({
      reusable: true,
      fingerprintMaterial: { fixture: "inline-replacement" },
    }),
    estimateCost: () => ({ kind: "none" }),
    execute: async (input) => ({
      output: (input as { question: string }).question,
    }),
    projectOutput: (result) => result.output,
    projectResponse: (result) => ({
      runId: "run_000000000000000000000001",
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
  id: "inline-replacement",
  task,
  cases: [{ id: "inline-replacement-case", input: { question: "run" } }],
  variants: { inline: { task: replacement } },
});
