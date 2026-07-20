import { evaluate } from "@use-crux/core/eval";
import { attachEvalTaskDescriptorForInternalUse } from "@use-crux/core/eval/internal/task";
import {
  createCruxRunId,
  createCruxSpanId,
  createCruxTraceId,
} from "@use-crux/core/observability";
import { createRuntimeWithHostContext } from "@use-crux/core/runtime";
import {
  createDeployedEvalRegistry,
  fingerprintDeployedEvalCase,
  projectDeployedEvalVariants,
} from "@use-crux/core/runtime/internal/eval-registry";
import { cloudflare } from "../../../src/index";

export function fixtureRegistry() {
  const task = attachEvalTaskDescriptorForInternalUse(
    async (input: { message: string }) => input.message,
    {
      _tag: "CruxEvalTaskDescriptor",
      operation: "generate",
      adapterId: "ai-sdk",
      capabilities: [],
      requiredHostCapabilities: ["asset-store"],
      defaults: { prompt: "refund policy" },
      overrideKeys: [],
      projectIdentity: () => ({
        reusable: true,
        fingerprintMaterial: { adapter: "workerd-fixture-v1" },
      }),
      execute: async (input) => {
        await Promise.resolve();
        const runtime = createRuntimeWithHostContext({
          runtime: cloudflare({ namespace: "nested-fixture" }),
          startMaintenance: false,
        });
        runtime.dispose();
        return { output: input };
      },
      projectOutput: (result) => result.output,
      projectResponse: () => ({
        runId: createCruxRunId(),
        _meta: {
          traceId: createCruxTraceId(),
          spanId: createCruxSpanId(),
        },
        content: [],
        text: "Can I get a refund?",
        steps: [],
        finalStep: {
          content: [],
          text: "Can I get a refund?",
          finishReason: "stop",
          responseId: "response-1",
          modelId: "fixture",
          warnings: [],
        },
        messages: [],
        warnings: [],
      }),
    },
  );
  const authored = {
    id: "refund",
    input: { message: "Can I get a refund?" },
  } as const;
  const evalValue = evaluate({ id: "support", task, cases: [authored] });

  return createDeployedEvalRegistry({
    entries: [
      {
        eval: evalValue,
        id: "support",
        source: "evals/support.eval.ts",
        evalFingerprint: "eval-support-v1",
        cases: [
          {
            id: authored.id,
            fingerprint: fingerprintDeployedEvalCase(authored.id, authored),
            authored,
          },
        ],
        variants: projectDeployedEvalVariants(evalValue),
        runtimeArms: [
          { name: "current", requiredHostCapabilities: ["asset-store"] },
        ],
        requiredHostCapabilities: ["asset-store"],
        index: {
          id: "support",
          source: "evals/support.eval.ts",
          requiredHostCapabilities: ["asset-store"],
        },
      },
    ],
  });
}
