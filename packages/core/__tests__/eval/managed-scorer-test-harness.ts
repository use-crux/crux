import { vi } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import type {
  EvalEvidenceStore,
  EvalExecutionPorts,
  EvalPlanningPorts,
} from "../../src/eval/internal/ports";
import { attachEvalTaskDescriptorForInternalUse } from "../../src/eval/internal/task";
import { scorers } from "../../src/eval/internal/scorers/types";

export const taskIdentity = {
  reusable: true as const,
  fingerprintMaterial: { task: "v1" },
};

export function response(responseId = "response-1") {
  return {
    content: [],
    text: "yes",
    steps: [],
    finalStep: {
      content: [],
      text: "yes",
      finishReason: "stop",
      responseId,
      modelId: "fake",
      warnings: [],
    },
    messages: [],
    warnings: [],
  };
}

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
    projectIdentity: () => taskIdentity,
    projectScorerContext: (request) => ({
      reusable: true,
      fingerprintMaterial: {
        adapter: "fake",
        model: request.model ?? "judge-v1",
      },
    }),
    createScorerContext: () => ({
      generate: async () => ({ object: { reasoning: "good", score: 1 } }),
      model: "judge-v1",
    }),
    execute: async () => ({ output: "yes" }),
    projectOutput: (result) => result.output,
    projectResponse: () => response(),
  },
);

export function createManagedScorerHarness() {
  const entries = new Map<string, unknown>();
  const evidenceStore: EvalEvidenceStore = {
    identity: "memory",
    consistency: "read_after_write",
    read: async (key) => entries.get(key),
    write: async (entry) => void entries.set(entry.key, entry),
  };
  let taskOutput = "yes";
  let taskResponseId = "response-1";
  const taskExecute = vi.fn(async () => ({
    output: taskOutput,
    response: response(taskResponseId),
    capturedSignals: [],
    runIds: ["task-run-1"],
    metrics: { durationMs: 1 },
    observedIdentity: taskIdentity,
  }));
  const scorerExecute = vi.fn(
    async (request: { readonly scorerName: string }) => ({
      score: {
        name: request.scorerName,
        score: 1,
        metadata: { rationale: "good" },
      },
    }),
  );
  const planning: EvalPlanningPorts = {
    evidenceStore,
    costEstimator: { estimate: () => ({ kind: "none" }) },
    externalScorerHostContractFingerprint: "judge-host-v1",
    externalScorerSourceFingerprint: "eval-source-v1",
    taskIdentity: {
      describe: async () => ({
        reusable: true,
        managedTaskFingerprint: "registry-v1",
        hostContractFingerprint: "task-host-v1",
      }),
    },
  };
  const execution = (): EvalExecutionPorts => ({
    evidenceStore,
    taskHost: { execute: taskExecute },
    externalScorerHost: { execute: scorerExecute },
    clock: { now: () => 1 },
    ids: { next: () => "eval-run-1" },
    runStore: { write: async () => undefined },
  });
  return {
    entries,
    evidenceStore,
    planning,
    execution,
    taskExecute,
    scorerExecute,
    setTaskOutput(output: string) {
      taskOutput = output;
    },
    setTaskResponseId(responseId: string) {
      taskResponseId = responseId;
    },
  };
}

export function managedScorerDefinition(
  rubric: string,
  gates?: { readonly latency: { readonly meanMs: number } },
) {
  return evaluate({
    id: "support",
    task,
    cases: [{ id: "refund", input: { question: "yes" }, expected: "yes" }],
    scorers: [scorers.judge({ name: "helpful", rubric })],
    ...(gates !== undefined ? { gates } : {}),
  });
}

export const managedScorerSource = {
  sourceKey: { relativeFile: "support.eval.ts", export: "default" as const },
};
