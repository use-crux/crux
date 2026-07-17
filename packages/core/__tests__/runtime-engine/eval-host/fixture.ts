import { evaluate } from "../../../src/eval";
import { attachEvalTaskDescriptorForInternalUse } from "../../../src/eval/internal/task";
import type { EvalRequiredHostCapability } from "../../../src/eval/internal/task";
import {
  createDeployedEvalRegistry,
  fingerprintDeployedEvalCase,
  projectDeployedEvalVariants,
} from "../../../src/runtime/eval-registry";
import { CRUX_EVAL_HOST_PROTOCOL } from "../../../src/runtime/eval-host";
import { createCruxRunId } from "../../../src/observability";

export const TOKEN = "eval-execute-capability-token-32-bytes";
export const NOW = new Date("2026-07-16T18:00:00.000Z");

export function fixtureRegistry(
  execute: (input: unknown) => Promise<{ output: unknown }> = async (
    input,
  ) => ({ output: input }),
  requiredHostCapabilities: readonly EvalRequiredHostCapability[] = [],
  operation: "generate" | "stream" = "generate",
) {
  const task = attachEvalTaskDescriptorForInternalUse(
    async (input: { message: string }) => input.message,
    {
      _tag: "CruxEvalTaskDescriptor",
      operation,
      adapterId: "ai-sdk",
      capabilities: [],
      requiredHostCapabilities,
      defaults: { prompt: "refund policy" },
      overrideKeys: ["temperature"],
      projectIdentity: () => ({
        reusable: true,
        fingerprintMaterial: { adapter: "fixture-v1" },
      }),
      execute,
      projectOutput: (result) => result.output,
      projectResponse: (result) => ({
        runId: createCruxRunId(),
        content: [],
        text: responseText(result.output),
        steps: [],
        finalStep: {
          content: [],
          text: responseText(result.output),
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
  const account = {
    id: "account",
    input: { message: "How do I update my account?" },
  } as const;
  const evalValue = evaluate({
    id: "support",
    task,
    cases: [authored, account],
    variants: {
      zeta: { temperature: 1 },
      alpha: { temperature: 0 },
    },
  });
  return createDeployedEvalRegistry({
    entries: [
      {
        eval: evalValue,
        id: "support",
        source: "evals/support.eval.ts",
        evalFingerprint: "eval-support-v1",
        cases: [
          {
            id: "refund",
            fingerprint: fingerprintDeployedEvalCase("refund", authored),
            authored,
          },
          {
            id: "account",
            fingerprint: fingerprintDeployedEvalCase("account", account),
            authored: account,
          },
        ],
        variants: projectDeployedEvalVariants(evalValue),
        requiredHostCapabilities,
        index: {
          id: "support",
          source: "evals/support.eval.ts",
          requiredHostCapabilities,
        },
      },
    ],
  });
}

export function authorizedRequest(
  path: string,
  init: RequestInit = {},
): Request {
  return new Request(`https://runtime.example${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

export async function pollUntilTerminal(
  host: { fetch(request: Request): Promise<Response> },
  jobId: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await host.fetch(authorizedRequest(`/jobs/${jobId}`));
    const body = (await response.json()) as Record<string, unknown>;
    if (body.status !== "accepted" && body.status !== "running") return body;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Eval job '${jobId}' did not become terminal.`);
}

export function jobBody(registry: ReturnType<typeof fixtureRegistry>) {
  const entry = registry.entries[0]!;
  return {
    protocol: CRUX_EVAL_HOST_PROTOCOL,
    jobId: "job-support-refund-current-0",
    evalRunId: "eval-run-1",
    evalId: entry.id,
    evalFingerprint: entry.evalFingerprint,
    caseId: entry.cases[0]!.id,
    caseFingerprint: entry.cases[0]!.fingerprint,
    variant: entry.variants[0]!.name,
    variantFingerprint: entry.variants[0]!.fingerprint,
    trial: 0,
    deadlineAt: "2026-07-16T19:00:00.000Z",
  } as const;
}

export function post(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

function responseText(output: unknown): string {
  return typeof output === "object" &&
    output !== null &&
    "message" in output &&
    typeof output.message === "string"
    ? output.message
    : "";
}
