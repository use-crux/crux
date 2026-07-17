import type {
  EvalHostManifestV1,
  EvalHostTransport,
} from "../../../runtime/eval-host";
import { EvalHostManifestCompatibilityError } from "../../../runtime/eval-host";
import { RUNTIME_RESULT_MAX_BYTES } from "../../../runtime/results/types";
import {
  fingerprintDeployedEvalCase,
  projectDeployedEvalRequiredHostCapabilities,
  projectDeployedEvalVariants,
} from "../../../runtime/eval-registry/projection";
import type { RuntimeEngineDefinition } from "../../../runtime/api/runtime-definition";
import type { EvalHostReadinessProvider } from "../../internal/ports";
import type {
  EvalHostReadiness,
  EvalTaskHostRequest,
  EvalTaskHostResult,
} from "../../internal/types";
import { fingerprintEvalValue } from "../../internal/identity";
import type { HydratedEval } from "../cases";
import { resolveNodeEvalHostConnection } from "./connection";
import { loadSelectedRuntimeDefinition } from "./runtime-config";

/** Invocation-scoped manifest resolver shared by CLI and programmatic runs. */
export function createNodeEvalHostReadiness(input: {
  readonly entry: HydratedEval;
  readonly projectRoot: string;
  readonly runtime?: RuntimeEngineDefinition;
  readonly processEnvironment?: NodeJS.ProcessEnv;
  readonly transport?: EvalHostTransport;
}): EvalHostReadinessProvider {
  return createNodeEvalHostRuntime(input).readiness;
}

/** Bind one memoized readiness proof and remote executor for a Node invocation. */
export function createNodeEvalHostRuntime(input: {
  readonly entry: HydratedEval;
  readonly projectRoot: string;
  readonly runtime?: RuntimeEngineDefinition;
  readonly processEnvironment?: NodeJS.ProcessEnv;
  readonly transport?: EvalHostTransport;
}) {
  let result: ReturnType<typeof resolveReadiness> | undefined;
  const resolved = () => (result ??= resolveReadiness(input));
  return Object.freeze({
    readiness: Object.freeze({
      resolve: async () => (await resolved()).readiness,
    }),
    execute: async (request: EvalTaskHostRequest) =>
      await executeRemote(input.entry, request, await resolved()),
  });
}

async function resolveReadiness(
  input: Parameters<typeof createNodeEvalHostReadiness>[0],
): Promise<{
  readonly readiness: EvalHostReadiness;
  readonly connection?: Extract<
    Awaited<ReturnType<typeof resolveNodeEvalHostConnection>>,
    { status: "connected" }
  >;
}> {
  const runtime =
    input.runtime ?? (await loadSelectedRuntimeDefinition(input.projectRoot));
  const connection = await resolveNodeEvalHostConnection({
    projectRoot: input.projectRoot,
    ...(runtime ? { runtime } : {}),
    ...(input.processEnvironment
      ? { processEnvironment: input.processEnvironment }
      : {}),
    ...(input.transport ? { transport: input.transport } : {}),
  });
  if (connection.status === "unverified") return { readiness: connection };
  let manifest;
  try {
    manifest = await connection.client.manifest();
  } catch (error) {
    if (error instanceof EvalHostManifestCompatibilityError) {
      return {
        readiness: mismatch(
          "The authenticated Runtime manifest uses an incompatible Eval host protocol.",
        ),
      };
    }
    return {
      readiness: Object.freeze({
        status: "unverified" as const,
        reason: "transport" as const,
        remedies: Object.freeze([
          "Verify CRUX_EVAL_HOST_URL and CRUX_EVAL_HOST_TOKEN, then deploy the generated Runtime entry.",
        ]),
      }),
    };
  }
  const manifestMismatch = compareManifest(
    input.entry,
    connection.deploymentId,
    manifest,
  );
  return {
    readiness:
      manifestMismatch ??
      Object.freeze({
        status: "verified" as const,
        deploymentId: connection.deploymentId,
        hostKind: manifest.hostKind,
      }),
    ...(manifestMismatch ? {} : { connection }),
  };
}

async function executeRemote(
  entry: HydratedEval,
  request: EvalTaskHostRequest,
  resolved: Awaited<ReturnType<typeof resolveReadiness>>,
): Promise<EvalTaskHostResult> {
  if (!resolved.connection || resolved.readiness.status !== "verified") {
    throw new TypeError("The selected deployed Runtime was not verified.");
  }
  const evalCase = entry.cases.find((item) => item.id === request.caseId);
  const variant = projectDeployedEvalVariants(entry.eval).find(
    (item) => item.name === request.variant,
  );
  if (!evalCase || !variant)
    throw new TypeError("The planned remote Eval cell is stale.");
  const identity = fingerprintEvalValue({
    eval: entry.definitionFingerprint,
    case: request.caseId,
    variant: request.variant,
    trial: request.trial,
  });
  let status = await resolved.connection.client.submit({
    protocol: "crux.eval-host.v1",
    jobId: `job-${identity}`,
    evalRunId: `run-${identity}`,
    evalId: entry.id,
    evalFingerprint: entry.definitionFingerprint,
    caseId: request.caseId,
    caseFingerprint: fingerprintDeployedEvalCase(
      evalCase.id,
      evalCase.authored,
    ),
    variant: request.variant,
    variantFingerprint: variant.fingerprint,
    trial: request.trial,
    deadlineAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  for (
    let poll = 0;
    poll < 100 && (status.status === "accepted" || status.status === "running");
    poll += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    status = await resolved.connection.client.poll(status.jobId);
  }
  if (status.status !== "succeeded") {
    const code =
      "error" in status ? status.error.code : "EVAL_HOST_POLL_TIMEOUT";
    throw new TypeError(`Deployed Eval execution failed (${code}).`);
  }
  return decodeRemoteResult(status.result);
}

function decodeRemoteResult(value: unknown): EvalTaskHostResult {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Deployed Eval returned an incompatible result.");
  }
  const result = value as Partial<EvalTaskHostResult>;
  if (
    !("output" in result) ||
    typeof result.response !== "object" ||
    !Array.isArray(result.capturedSignals) ||
    !Array.isArray(result.runIds) ||
    typeof result.metrics?.durationMs !== "number" ||
    typeof result.observedIdentity !== "object"
  ) {
    throw new TypeError("Deployed Eval returned an incompatible result.");
  }
  return Object.freeze(result as EvalTaskHostResult);
}

function compareManifest(
  entry: HydratedEval,
  expectedDeploymentId: string,
  manifest: EvalHostManifestV1,
): Extract<EvalHostReadiness, { status: "mismatch" }> | undefined {
  if (manifest.deploymentId !== expectedDeploymentId) {
    return mismatch(
      `Expected Runtime deployment '${expectedDeploymentId}', but the authenticated host reported '${manifest.deploymentId}'.`,
    );
  }
  if (manifest.resultMaxBytes < RUNTIME_RESULT_MAX_BYTES) {
    return mismatch(
      "The selected Runtime does not provide the required Eval result capability.",
    );
  }
  const deployed = manifest.evals.find(
    (candidate) => candidate.id === entry.id,
  );
  if (!deployed)
    return mismatch(`Eval '${entry.id}' is missing from the selected Runtime.`);
  const expectedCases = Object.fromEntries(
    entry.cases.map((item) => [
      item.id,
      fingerprintDeployedEvalCase(item.id, item.authored),
    ]),
  );
  const expectedVariants = Object.fromEntries(
    projectDeployedEvalVariants(entry.eval).map((item) => [
      item.name,
      item.fingerprint,
    ]),
  );
  const expectedCapabilities = projectDeployedEvalRequiredHostCapabilities(
    entry.eval,
  );
  if (
    deployed.evalFingerprint !== entry.definitionFingerprint ||
    !recordsEqual(deployed.cases, expectedCases) ||
    !recordsEqual(deployed.variants, expectedVariants) ||
    !setsEqual(deployed.requiredHostCapabilities, expectedCapabilities) ||
    expectedCapabilities.some(
      (capability) => !manifest.capabilities.includes(capability),
    )
  ) {
    return mismatch(
      `Eval '${entry.id}' is stale or unsupported on the selected Runtime.`,
    );
  }
  return undefined;
}

function recordsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  );
}

function setsEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

function mismatch(reason: string) {
  return Object.freeze({
    status: "mismatch" as const,
    reason,
    remedy:
      "Run crux index reindex, then crux runtime generate and deploy the selected Runtime.",
  });
}
