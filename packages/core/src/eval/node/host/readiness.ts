import type {
  EvalHostClient,
  EvalHostJobStatusV1,
  EvalHostManifestV1,
  EvalHostTransport,
} from "../../../runtime/eval-host";
import {
  EVAL_HOST_REQUEST_TIMEOUT_MS,
  EvalHostClientTransportError,
  EvalHostManifestCompatibilityError,
} from "../../../runtime/eval-host";
import { RUNTIME_RESULT_MAX_BYTES } from "../../../runtime/results/types";
import { decodeEvalHostResult } from "../../../runtime/eval-host/result-codec";
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
import {
  DEFAULT_EVAL_PERSISTENCE_POLICY,
  fingerprintEvalPersistencePolicy,
  type EvalPersistencePolicy,
} from "../../internal/redact";
import type { HydratedEval } from "../cases";
import { resolveNodeEvalHostConnection } from "./connection";
import { loadSelectedRuntimeDefinition } from "./runtime-config";

interface EvalHostPollingOptions {
  readonly now?: () => number;
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** Poll one durable host job until it settles or its admitted deadline passes. @internal */
export async function pollEvalHostJobForInternalUse(
  client: EvalHostClient,
  initial: EvalHostJobStatusV1,
  deadlineAtMs: number,
  options: EvalHostPollingOptions = {},
): Promise<EvalHostJobStatusV1> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((durationMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const requestTimeoutMs =
    options.requestTimeoutMs ?? EVAL_HOST_REQUEST_TIMEOUT_MS;
  let status = initial;
  while (status.status === "accepted" || status.status === "running") {
    const remainingMs = deadlineAtMs - now();
    if (remainingMs <= 0) return status;
    await waitForNextPoll(
      sleep(Math.min(pollIntervalMs, remainingMs)),
      options.signal,
    );
    const requestRemainingMs = deadlineAtMs - now();
    if (requestRemainingMs <= 0) return status;
    const timeoutMs = Math.min(requestRemainingMs, requestTimeoutMs);
    const deadlineBound = requestRemainingMs <= requestTimeoutMs;
    try {
      status = await client.poll(status.jobId, {
        ...(options.signal ? { signal: options.signal } : {}),
        timeoutMs,
      });
    } catch (error) {
      if (
        deadlineBound &&
        error instanceof EvalHostClientTransportError &&
        error.code === "EVAL_HOST_REQUEST_TIMEOUT"
      ) {
        return status;
      }
      throw error;
    }
  }
  return status;
}

async function waitForNextPoll(
  pending: Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!signal) return pending;
  if (signal.aborted) throw pollAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(pollAborted());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([pending, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function pollAborted(): EvalHostClientTransportError {
  return new EvalHostClientTransportError(
    "EVAL_HOST_REQUEST_ABORTED",
    "poll",
    "The Eval host poll request was cancelled by its caller.",
  );
}

/** Invocation-scoped manifest resolver shared by CLI and programmatic runs. */
export function createNodeEvalHostReadiness(input: {
  readonly entry: HydratedEval;
  readonly projectRoot: string;
  readonly runtime?: RuntimeEngineDefinition;
  readonly processEnvironment?: NodeJS.ProcessEnv;
  readonly transport?: EvalHostTransport;
  readonly persistencePolicy?: EvalPersistencePolicy;
}): EvalHostReadinessProvider {
  return createNodeEvalHostRuntime(input).readiness;
}

type NodeEvalHostDeploymentInput = Omit<
  Parameters<typeof createNodeEvalHostReadiness>[0],
  "entry"
>;

/** Share one connection and authenticated manifest across a Node invocation. */
export function createNodeEvalHostDeployment(
  input: NodeEvalHostDeploymentInput,
) {
  let result: ReturnType<typeof resolveDeployment> | undefined;
  return Object.freeze({
    resolve: () => (result ??= resolveDeployment(input)),
  });
}

/** Bind one memoized readiness proof and remote executor for a Node invocation. */
export function createNodeEvalHostRuntime(input: {
  readonly entry: HydratedEval;
  readonly projectRoot: string;
  readonly runtime?: RuntimeEngineDefinition;
  readonly processEnvironment?: NodeJS.ProcessEnv;
  readonly transport?: EvalHostTransport;
  readonly deployment?: ReturnType<typeof createNodeEvalHostDeployment>;
  readonly persistencePolicy?: EvalPersistencePolicy;
}) {
  const deployment =
    input.deployment ?? createNodeEvalHostDeployment(withoutEntry(input));
  let result: ReturnType<typeof resolveReadiness> | undefined;
  const resolved = () =>
    (result ??= resolveReadiness(
      input.entry,
      fingerprintEvalPersistencePolicy(
        input.persistencePolicy ?? DEFAULT_EVAL_PERSISTENCE_POLICY,
      ),
      deployment.resolve(),
    ));
  return Object.freeze({
    readiness: Object.freeze({
      resolve: async () => (await resolved()).readiness,
    }),
    execute: async (request: EvalTaskHostRequest) =>
      await executeRemote(input.entry, request, await resolved()),
  });
}

async function resolveReadiness(
  entry: HydratedEval,
  expectedPrivacyFingerprint: string,
  deployment: ReturnType<
    ReturnType<typeof createNodeEvalHostDeployment>["resolve"]
  >,
): Promise<{
  readonly readiness: EvalHostReadiness;
  readonly connection?: Extract<
    Awaited<ReturnType<typeof resolveNodeEvalHostConnection>>,
    { status: "connected" }
  >;
}> {
  const resolved = await deployment;
  if (resolved.kind === "unready") return { readiness: resolved.readiness };
  const { connection, manifest } = resolved;
  const manifestMismatch = compareManifest(
    entry,
    connection.deploymentId,
    expectedPrivacyFingerprint,
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

async function resolveDeployment(input: NodeEvalHostDeploymentInput) {
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
  if (connection.status === "unverified") {
    return { kind: "unready" as const, readiness: connection };
  }
  let manifest;
  try {
    manifest = await connection.client.manifest();
  } catch (error) {
    if (error instanceof EvalHostManifestCompatibilityError) {
      return {
        kind: "unready" as const,
        readiness: mismatch(
          "The authenticated Runtime manifest uses an incompatible Eval host protocol.",
        ),
      };
    }
    return {
      kind: "unready" as const,
      readiness: Object.freeze({
        status: "unverified" as const,
        reason: "transport" as const,
        remedies: Object.freeze([
          "Verify CRUX_EVAL_HOST_URL and CRUX_EVAL_HOST_TOKEN, then deploy the generated Runtime entry.",
        ]),
      }),
    };
  }
  return { kind: "connected" as const, connection, manifest };
}

function withoutEntry(
  input: Parameters<typeof createNodeEvalHostRuntime>[0],
): NodeEvalHostDeploymentInput {
  return {
    projectRoot: input.projectRoot,
    ...(input.runtime ? { runtime: input.runtime } : {}),
    ...(input.processEnvironment
      ? { processEnvironment: input.processEnvironment }
      : {}),
    ...(input.transport ? { transport: input.transport } : {}),
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
    ...(request.executionAttemptId !== undefined
      ? { executionAttempt: request.executionAttemptId }
      : {}),
  });
  const deadlineAtMs = Date.now() + 10 * 60_000;
  const jobId = `job-${identity}`;
  const evalRunId = `run-${identity}`;
  const submitted = await resolved.connection.client.submit({
    protocol: "crux.eval-host.v1",
    jobId,
    evalRunId,
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
    deadlineAt: new Date(deadlineAtMs).toISOString(),
  });
  const status = await pollEvalHostJobForInternalUse(
    resolved.connection.client,
    submitted,
    deadlineAtMs,
  );
  if (status.status !== "succeeded") {
    const code =
      "error" in status ? status.error.code : "EVAL_HOST_POLL_TIMEOUT";
    throw new TypeError(`Deployed Eval execution failed (${code}).`);
  }
  return decodeEvalHostResult(status.result, { jobId, evalRunId });
}

function compareManifest(
  entry: HydratedEval,
  expectedDeploymentId: string,
  expectedPrivacyFingerprint: string,
  manifest: EvalHostManifestV1,
): Extract<EvalHostReadiness, { status: "mismatch" }> | undefined {
  if (manifest.deploymentId !== expectedDeploymentId) {
    return mismatch(
      `Expected Runtime deployment '${expectedDeploymentId}', but the authenticated host reported '${manifest.deploymentId}'.`,
    );
  }
  if (manifest.privacyFingerprint !== expectedPrivacyFingerprint) {
    return mismatch(
      "The selected Runtime was generated with a different observability.redactPaths policy.",
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
