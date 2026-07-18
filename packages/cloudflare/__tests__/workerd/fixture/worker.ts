import { createCloudflareEvalHost } from "../../../src/index";
import { fixtureRegistry } from "./registry";
import { nestedTask } from "./target";

interface Env {
  readonly CRUX_EVAL_HOST: DurableObjectNamespace;
  readonly CRUX_EVAL_HOST_TOKEN: string;
}

const host = createCloudflareEvalHost<Env>({
  binding: "CRUX_EVAL_HOST",
  deploymentId: "production-eu",
  registry: fixtureRegistry(),
  targets: [nestedTask],
  token: (env) => env.CRUX_EVAL_HOST_TOKEN,
  limits: { maxConcurrentJobs: 1 },
});

export const CruxEvalHost = host.DurableObject;
export default { fetch: host.fetch };
