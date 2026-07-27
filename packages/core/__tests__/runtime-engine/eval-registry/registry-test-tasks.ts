import { attachEvalTaskDescriptorForInternalUse } from "../../../src/eval/internal/task";

/** Managed fixture whose Current arm requires asset storage. */
export function managedTask() {
  return attachEvalTaskDescriptorForInternalUse(
    async (input: { message: string }) => input.message,
    {
      _tag: "CruxEvalTaskDescriptor",
      identityEpoch: 2,
      operation: "generate",
      adapterId: "ai-sdk",
      capabilities: [],
      requiredHostCapabilities: ["asset-store"],
      defaults: {},
      overrideKeys: ["temperature"],
      projectIdentity: () => ({ reusable: true, fingerprintMaterial: {} }),
      execute: async (input) => ({ output: input }),
      projectOutput: (result) => result.output,
      projectResponse: (result) => ({ output: result.output }),
    },
  );
}

/** Managed fixture used only by the remotely hosted Variant arm. */
export function hostedTask() {
  return attachEvalTaskDescriptorForInternalUse(
    async (input: { message: string }) => input.message,
    {
      _tag: "CruxEvalTaskDescriptor",
      identityEpoch: 2,
      operation: "generate",
      adapterId: "ai-sdk",
      capabilities: [],
      requiredHostCapabilities: ["asset-store"],
      defaults: {},
      overrideKeys: [],
      projectIdentity: () => ({
        reusable: true,
        fingerprintMaterial: { task: "hosted" },
      }),
      execute: async (input) => ({ output: input }),
      projectOutput: (result) => result.output,
      projectResponse: (result) => ({ output: result.output }),
    },
  );
}
