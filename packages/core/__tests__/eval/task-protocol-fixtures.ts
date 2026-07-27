import {
  EVAL_TASK_IDENTITY_EPOCH,
  attachEvalTaskDescriptorForInternalUse,
} from "../../src/eval/internal/task";

/** Managed descriptor fixture with optional host capability requirements. */
export function managedProtocolTask(
  execute: () => Promise<{ object: string }>,
  requiredHostCapabilities: readonly "record-store"[] | undefined,
) {
  return attachEvalTaskDescriptorForInternalUse(async () => undefined, {
    _tag: "CruxEvalTaskDescriptor",
    identityEpoch: EVAL_TASK_IDENTITY_EPOCH,
    operation: "generate",
    adapterId: "ai-sdk",
    capabilities: ["modelCalls"],
    ...(requiredHostCapabilities !== undefined
      ? { requiredHostCapabilities }
      : {}),
    defaults: {},
    overrideKeys: [],
    outputContractFingerprint: "output-v1",
    callContractFingerprint: "call-v1",
    projectIdentity: () => ({
      reusable: true,
      fingerprintMaterial: { contract: "adapter-projection-v1" },
    }),
    execute,
    projectOutput: (result) => result.object,
    projectResponse: () => ({}) as never,
  });
}
