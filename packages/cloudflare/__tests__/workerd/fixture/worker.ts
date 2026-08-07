import { createCloudflareEvalHost } from "../../../src/index";
import { createRuntimeProgram } from "@use-crux/core/runtime";
import { fixtureRegistry } from "./registry";
import { nestedTask } from "./target";

interface Env {
  readonly CRUX_EVAL_HOST: DurableObjectNamespace;
  readonly CRUX_EVAL_HOST_TOKEN: string;
}

const targets = [nestedTask] as const;
const program = createRuntimeProgram({
  targets,
  effectTargets: [],
  transports: [],
});

const host = createCloudflareEvalHost<Env>({
  binding: "CRUX_EVAL_HOST",
  deploymentId: "production-eu",
  registry: fixtureRegistry(),
  hostCapabilities: ["asset-store"],
  targets,
  program,
  token: (env) => env.CRUX_EVAL_HOST_TOKEN,
  limits: { maxConcurrentJobs: 1 },
});

export const CruxEvalHost = host.DurableObject;
export default { fetch: host.fetch };
