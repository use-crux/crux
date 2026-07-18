import type { RuntimeEngineDefinition } from "../../../runtime/api/runtime-definition";
import {
  createEvalHostClient,
  getEvalHostConnectionInference,
  type EvalHostClient,
  type EvalHostTransport,
} from "../../../runtime/eval-host";
import { readEvalHostEnvironment } from "./environment";

export type NodeEvalHostConnectionResult =
  | {
      readonly status: "connected";
      readonly deploymentId: string;
      readonly client: EvalHostClient;
    }
  | {
      readonly status: "unverified";
      readonly reason: "connection_unavailable";
      readonly remedies: readonly string[];
    };

/** Resolve one selected Runtime connection without exposing its bearer. */
export async function resolveNodeEvalHostConnection(input: {
  readonly projectRoot: string;
  readonly runtime?: RuntimeEngineDefinition;
  readonly processEnvironment?: NodeJS.ProcessEnv;
  readonly transport?: EvalHostTransport;
}): Promise<NodeEvalHostConnectionResult> {
  const environment = await readEvalHostEnvironment(
    input.projectRoot,
    input.processEnvironment,
  );
  const inferred = getEvalHostConnectionInference(input.runtime)?.infer(
    environment,
  );
  const url = nonempty(environment.CRUX_EVAL_HOST_URL) ?? inferred?.url;
  const deploymentId =
    nonempty(environment.CRUX_EVAL_HOST_DEPLOYMENT_ID) ??
    inferred?.deploymentId;
  const token = nonempty(environment.CRUX_EVAL_HOST_TOKEN);
  const remedies = [
    ...(url ? [] : ["Set CRUX_EVAL_HOST_URL."]),
    ...(deploymentId ? [] : ["Set CRUX_EVAL_HOST_DEPLOYMENT_ID."]),
    ...(token ? [] : ["Set CRUX_EVAL_HOST_TOKEN."]),
  ];
  if (!url || !deploymentId || !token) {
    return Object.freeze({
      status: "unverified" as const,
      reason: "connection_unavailable" as const,
      remedies: Object.freeze(remedies),
    });
  }
  return Object.freeze({
    status: "connected" as const,
    deploymentId,
    client: createEvalHostClient({
      baseUrl: validateBaseUrl(url),
      token,
      ...(input.transport ? { transport: input.transport } : {}),
    }),
  });
}

/** Resolve only the expected deployment identity for evidence-key planning. */
export async function resolveNodeEvalHostDeploymentId(input: {
  readonly projectRoot: string;
  readonly runtime?: RuntimeEngineDefinition;
  readonly processEnvironment?: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
  const environment = await readEvalHostEnvironment(
    input.projectRoot,
    input.processEnvironment,
  );
  const inferred = getEvalHostConnectionInference(input.runtime)?.infer(
    environment,
  );
  return (
    nonempty(environment.CRUX_EVAL_HOST_DEPLOYMENT_ID) ?? inferred?.deploymentId
  );
}

/** Read explicit deployment identity for strict-offline evidence lookup. */
export async function readExplicitNodeEvalHostDeploymentId(input: {
  readonly projectRoot: string;
  readonly processEnvironment?: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
  const environment = await readEvalHostEnvironment(
    input.projectRoot,
    input.processEnvironment,
  );
  return nonempty(environment.CRUX_EVAL_HOST_DEPLOYMENT_ID);
}

function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("CRUX_EVAL_HOST_URL must be a valid absolute URL.");
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new TypeError(
      "CRUX_EVAL_HOST_URL must use HTTPS outside loopback development.",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError(
      "CRUX_EVAL_HOST_URL must not contain credentials, a query, or a fragment.",
    );
  }
  return url.href;
}

function nonempty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
