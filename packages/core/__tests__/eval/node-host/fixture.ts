import { evaluate } from "../../../src/eval/evaluate";
import { attachEvalTaskDescriptorForInternalUse } from "../../../src/eval/internal/task";
import { createDeployedEvalRegistry } from "../../../src/runtime/eval-registry";
import {
  createCruxRunId,
  createCruxSpanId,
  createCruxTraceId,
} from "../../../src/observability";
import {
  fingerprintDeployedEvalCase,
  projectDeployedEvalVariants,
} from "../../../src/runtime/eval-registry/projection";
import {
  DEFAULT_EVAL_PERSISTENCE_POLICY,
  fingerprintEvalPersistencePolicy,
} from "../../../src/eval/internal/redact";
import type { TimeoutOptions } from "../../../src/generation/timeout";
import type { EvalTaskExecutionContext } from "../../../src/eval/internal/task-execution-context";

type RemoteExecute = (
  input: unknown,
  call: Readonly<object> | undefined,
  overrides: Readonly<object>,
  context: EvalTaskExecutionContext,
) => Promise<{ output: string }>;

export function hydratedEntry(
  options: {
    readonly timeout?: TimeoutOptions | null;
    readonly execute?: RemoteExecute;
  } = {},
) {
  const authored = Object.freeze({
    id: "refund",
    input: { question: "refund" },
  });
  const evalValue = evaluate({
    id: "support",
    task: remoteTask(undefined, options.execute),
    cases: [authored],
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
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

export function mixedAdapterEntry() {
  const entry = hydratedEntry();
  return Object.freeze({
    ...entry,
    eval: evaluate({
      id: entry.id,
      task: remoteTask([]),
      cases: entry.cases.map((item) => item.authored),
      variants: { hosted: { task: remoteTask(["record-store"]) } },
    }),
  });
}

export function manifest(
  entry: ReturnType<typeof hydratedEntry>,
  deploymentId: string,
) {
  return {
    protocol: "crux.eval-host.v2",
    deploymentId,
    hostKind: "memory",
    privacyFingerprint: fingerprintEvalPersistencePolicy(
      DEFAULT_EVAL_PERSISTENCE_POLICY,
    ),
    capabilities: ["record-store", "result-ref", "structured-timeout"],
    resultMaxBytes: 1024 * 1024,
    evals: [
      {
        id: entry.id,
        evalFingerprint: entry.definitionFingerprint,
        cases: {
          refund: fingerprintDeployedEvalCase(
            entry.eval,
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
              entry.eval,
              "refund",
              entry.cases[0]!.authored,
            ),
          },
        ],
        variants,
        runtimeArms: [
          { name: "current", requiredHostCapabilities: ["record-store"] },
        ],
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

function remoteTask(
  requiredHostCapabilities: readonly (
    | "asset-store"
    | "record-store"
    | "search-store"
  )[] = ["record-store"],
  execute: RemoteExecute = async () => ({ output: "yes" }),
) {
  return attachEvalTaskDescriptorForInternalUse(
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
      requiredHostCapabilities,
      callContractFingerprint: "node-host-fixture-call-v1",
      defaults: {},
      overrideKeys: [],
      projectIdentity: () => ({
        reusable: true,
        fingerprintMaterial: { adapter: "fixture" },
      }),
      execute,
      projectOutput: (result) => result.output,
      projectResponse: () => ({
        runId: createCruxRunId(),
        _meta: {
          traceId: createCruxTraceId(),
          spanId: createCruxSpanId(),
        },
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
