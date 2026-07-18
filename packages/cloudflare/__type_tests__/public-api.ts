import type { DeployedEvalRegistry } from "@use-crux/core/runtime/internal/eval-registry";
import { createCloudflareEvalHost } from "../src/index";

interface Env {
  readonly CRUX_EVAL_HOST: DurableObjectNamespace;
  readonly TOKEN: string;
}

declare const registry: DeployedEvalRegistry;

createCloudflareEvalHost<Env>({
  binding: "CRUX_EVAL_HOST",
  deploymentId: "production-eu",
  registry,
  token: (env) => env.TOKEN,
});

createCloudflareEvalHost<Env>({
  // @ts-expect-error Only Durable Object namespace bindings are accepted.
  binding: "TOKEN",
  deploymentId: "production-eu",
  registry,
  token: (env) => env.TOKEN,
});
