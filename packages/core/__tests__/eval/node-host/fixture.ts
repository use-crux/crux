import { evaluate } from "../../../src/eval/evaluate";
import { attachEvalTaskDescriptorForInternalUse } from "../../../src/eval/internal/task";
import { createDeployedEvalRegistry } from "../../../src/runtime/eval-registry";
import { createCruxRunId } from "../../../src/observability";
import {
  fingerprintDeployedEvalCase,
  projectDeployedEvalVariants,
} from "../../../src/runtime/eval-registry/projection";
import {
  DEFAULT_EVAL_PERSISTENCE_POLICY,
  fingerprintEvalPersistencePolicy,
} from "../../../src/eval/internal/redact";

export function hydratedEntry() {
  const authored = Object.freeze({
    id: "refund",
    input: { question: "refund" },
  });
  const evalValue = evaluate({
    id: "support",
    task: remoteTask(),
    cases: [authored],
  });
  return Object.freeze({
    id: "support",
    eval: evalValue,
    sourceKey: Object.freeze({
      relativeFile: "evals/support.eval.ts",
      export: "default" as const,
    }),
    sidecarFile: "evals/support.cases.jsonl",
    links: Object.freeze([]),
    cases: Object.freeze([
      Object.freeze({
        id: "refund",
        origin: "evals/support.eval.ts:inline:1",
        authored,
        unvalidatedExpected: false,
      }),
    ]),
    definitionFingerprint: "eval-support-v1",
    caseFileDependencies: Object.freeze([]),
  });
}

export function manifest(
  entry: ReturnType<typeof hydratedEntry>,
  deploymentId: string,
) {
  return {
    protocol: "crux.eval-host.v1",
    deploymentId,
    hostKind: "memory",
    privacyFingerprint: fingerprintEvalPersistencePolicy(
      DEFAULT_EVAL_PERSISTENCE_POLICY,
    ),
    capabilities: ["record-store", "result-ref"],
    resultMaxBytes: 1024 * 1024,
    evals: [
      {
        id: entry.id,
        evalFingerprint: entry.definitionFingerprint,
        cases: {
          refund: fingerprintDeployedEvalCase(
            "refund",
            entry.cases[0]!.authored,
          ),
        },
        variants: Object.fromEntries(
          projectDeployedEvalVariants(entry.eval).map((item) => [
            item.name,
            item.fingerprint,
          ]),
        ),
        requiredHostCapabilities: ["record-store"],
      },
    ],
  };
}

export function registry(entry: ReturnType<typeof hydratedEntry>) {
  const variants = projectDeployedEvalVariants(entry.eval);
  return createDeployedEvalRegistry({
    entries: [
      {
        eval: entry.eval,
        id: entry.id,
        source: entry.sourceKey.relativeFile,
        evalFingerprint: entry.definitionFingerprint,
        cases: [
          {
            id: "refund",
            authored: entry.cases[0]!.authored,
            fingerprint: fingerprintDeployedEvalCase(
              "refund",
              entry.cases[0]!.authored,
            ),
          },
        ],
        variants,
        requiredHostCapabilities: ["record-store"],
        index: {
          id: entry.id,
          source: entry.sourceKey.relativeFile,
          requiredHostCapabilities: ["record-store"],
        },
      },
    ],
  });
}

export function connectionEnvironment() {
  return {
    CRUX_EVAL_HOST_URL: "https://runtime.example.test",
    CRUX_EVAL_HOST_DEPLOYMENT_ID: "production",
    CRUX_EVAL_HOST_TOKEN: "top-secret-token",
  };
}

function remoteTask() {
  return attachEvalTaskDescriptorForInternalUse(
    Object.assign(async () => "unused", {
      _tag: "CruxTask" as const,
      operation: "function" as const,
    }),
    {
      _tag: "CruxEvalTaskDescriptor",
      operation: "generate",
      adapterId: "ai-sdk",
      capabilities: [],
      requiredHostCapabilities: ["record-store"],
      defaults: {},
      overrideKeys: [],
      projectIdentity: () => ({
        reusable: true,
        fingerprintMaterial: { adapter: "fixture" },
      }),
      execute: async () => ({ output: "yes" }),
      projectOutput: (result) => result.output,
      projectResponse: () => ({
        runId: createCruxRunId(),
        content: [],
        text: "yes",
        steps: [],
        messages: [],
        warnings: [],
        finalStep: {
          content: [],
          text: "yes",
          finishReason: "stop",
          responseId: "r",
          modelId: "m",
          warnings: [],
        },
      }),
    },
  );
}
