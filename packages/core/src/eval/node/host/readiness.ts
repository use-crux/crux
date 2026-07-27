import type {
  EvalHostManifest,
  EvalHostTransport,
} from "../../../runtime/eval-host";
import {
  EVAL_HOST_STRUCTURED_TIMEOUT_CAPABILITY,
  EvalHostManifestCompatibilityError,
} from "../../../runtime/eval-host";
import { RUNTIME_RESULT_MAX_BYTES } from "../../../runtime/results/types";
import {
  projectDeployedEvalRequiredHostCapabilities,
  projectDeployedEvalVariants,
} from "../../../runtime/eval-registry/projection";
import type { RuntimeEngineDefinition } from "../../../runtime/api/runtime-definition";
import type { EvalHostReadinessProvider } from "../../internal/ports";
import type {
  EvalHostReadiness,
  EvalTaskHostRequest,
} from "../../internal/types";
import {
  DEFAULT_EVAL_PERSISTENCE_POLICY,
  fingerprintEvalPersistencePolicy,
  type EvalPersistencePolicy,
} from "../../internal/redact";
import type { HydratedEval } from "../cases";
import { projectHydratedEvalCaseFingerprints } from "../deployment-identity";
import { resolveNodeEvalHostConnection } from "./connection";
import { loadSelectedRuntimeDefinition } from "./runtime-config";
import { executeRemoteEvalCell } from "./remote-execution";
export {
  EVAL_HOST_TERMINAL_GRACE_MS,
  pollEvalHostJobForInternalUse,
} from "./poll-job";

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
      await executeRemoteEvalCell(input.entry, request, await resolved()),
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

function compareManifest(
  entry: HydratedEval,
  expectedDeploymentId: string,
  expectedPrivacyFingerprint: string,
  manifest: EvalHostManifest,
): Extract<EvalHostReadiness, { status: "mismatch" }> | undefined {
  if (manifest.protocol !== "crux.eval-host.v2") {
    return mismatch(
      "The authenticated Runtime manifest uses an incompatible Eval host protocol.",
    );
  }
  if (
    !manifest.capabilities.includes(EVAL_HOST_STRUCTURED_TIMEOUT_CAPABILITY)
  ) {
    return mismatch(
      "The selected Runtime does not advertise structured timeout support.",
    );
  }
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
  const expectedCases = projectHydratedEvalCaseFingerprints(entry);
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
