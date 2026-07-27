import { attachEvalTaskDescriptorForInternalUse } from "../../../../src/eval/internal/task";
import { z } from "zod";
import { createCruxRunId } from "../../../../src/observability";

export const inputSchema = z.object({ question: z.string() });

export const task = attachEvalTaskDescriptorForInternalUse(
  async (input: { question: string }) => input.question,
  {
    _tag: "CruxEvalTaskDescriptor",
    identityEpoch: 2,
    operation: "generate",
    adapterId: "ai-sdk",
    callContractFingerprint: "fixture.generate.call.v1",
    inputSchema,
    capabilities: [],
    defaults: {},
    overrideKeys: [],
    projectIdentity: () => ({
      reusable: true,
      fingerprintMaterial: { fixture: "node-run-v1" },
    }),
    estimateCost: () => ({ kind: "none" }),
    execute: async (input) => ({
      output: (input as { question: string }).question,
    }),
    projectOutput: (result) => result.output,
    projectResponse: (result) => ({
      runId: createCruxRunId(),
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

export const replacementTask = attachEvalTaskDescriptorForInternalUse(
  async (input: { question: string }) => input.question,
  {
    _tag: "CruxEvalTaskDescriptor",
    identityEpoch: 2,
    operation: "generate",
    adapterId: "ai-sdk",
    callContractFingerprint: "fixture.generate.call.v1",
    inputSchema,
    capabilities: [],
    defaults: {},
    overrideKeys: [],
    projectIdentity: () => ({
      reusable: true,
      fingerprintMaterial: { fixture: "node-run-replacement-v1" },
    }),
    estimateCost: () => ({ kind: "none" }),
    execute: async (input) => ({
      output: (input as { question: string }).question,
    }),
    projectOutput: (result) => result.output,
    projectResponse: (result) => ({
      runId: createCruxRunId(),
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

// authored task revision
