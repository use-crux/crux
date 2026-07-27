import { evaluate } from "../../src/eval/evaluate";
import type {
  EvalEvidenceStore,
  EvalPlanningPorts,
} from "../../src/eval/internal/ports";
import { attachEvalTaskDescriptorForInternalUse } from "../../src/eval/internal/task";
import type { TimeoutOptions } from "../../src/generation/timeout";

export const task = attachEvalTaskDescriptorForInternalUse(
  Object.assign(async () => "unused", {
    _tag: "CruxTask" as const,
    operation: "function" as const,
  }),
  {
    _tag: "CruxEvalTaskDescriptor",
    identityEpoch: 2,
    operation: "generate",
    adapterId: "ai-sdk",
    capabilities: [],
    defaults: {},
    overrideKeys: [],
    projectIdentity: () => ({
      reusable: true,
      fingerprintMaterial: { adapter: "fake-v1" },
    }),
    execute: async () => taskResult(),
    projectOutput: (result) => result.output,
    projectResponse: (result) => result.response,
  },
);

export function evalValue(taskValue = task, timeout?: TimeoutOptions | null) {
  return evaluate({
    id: "support",
    task: taskValue,
    cases: [{ id: "refund", input: { question: "yes" } }],
    ...(timeout === undefined ? {} : { timeout }),
  });
}

export function memoryEvidenceStore(): EvalEvidenceStore & {
  readonly entries: Map<string, unknown>;
} {
  const entries = new Map<string, unknown>();
  return {
    identity: "memory",
    consistency: "read_after_write",
    entries,
    read: async (key) => entries.get(key),
    write: async (entry) => void entries.set(entry.key, entry),
  };
}

export function planningPorts(
  evidenceStore: EvalEvidenceStore,
): EvalPlanningPorts {
  return {
    evidenceStore,
    costEstimator: { estimate: () => ({ kind: "none" }) },
    taskIdentity: {
      describe: async () => ({
        managedTaskFingerprint: "task-v1",
        hostContractFingerprint: "host-v1",
        reusable: true,
      }),
    },
  };
}

/** Planning ports for fake task-host tests that intentionally perform no billable work. */
export function nonBillablePlanningPorts(): EvalPlanningPorts {
  return {
    evidenceStore: memoryEvidenceStore(),
    costEstimator: { estimate: () => ({ kind: "none" }) },
    taskIdentity: {
      describe: async () => ({
        reusable: false,
        reason: "identity_unavailable",
      }),
    },
  };
}

export function taskResult(
  output: unknown = "yes",
  fingerprintMaterial: Readonly<Record<string, unknown>> = {
    adapter: "fake-v1",
  },
) {
  return {
    output,
    response: {
      content: [],
      text: "yes",
      steps: [],
      finalStep: {
        content: [],
        text: "yes",
        finishReason: "stop",
        responseId: "response-1",
        modelId: "fake",
        warnings: [],
      },
      messages: [],
      warnings: [],
    },
    capturedSignals: [],
    runIds: ["task-run-1"],
    metrics: { durationMs: 20 },
    observedIdentity: { reusable: true as const, fingerprintMaterial },
  };
}
