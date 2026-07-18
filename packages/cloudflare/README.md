# @use-crux/cloudflare

Cloudflare Workers and Durable Object hosting for Crux Runtime and deployed
Evals.

## Install

```bash
pnpm add @use-crux/cloudflare @use-crux/core
```

## Request lifecycle

Use `withCrux` when a Worker handler needs request-scoped `defer()` and a
bounded observability drain. The wrapper retains the whole root through one
structural `ExecutionContext.waitUntil()` call and requires no `nodejs_compat`.

```ts
import { defer } from "@use-crux/core";
import { withCrux } from "@use-crux/cloudflare";

export default {
  fetch: withCrux(
    async (request, env, ctx) => {
      defer(() => env.ANALYTICS.writeDataPoint({ blobs: [request.url] }));
      return new Response("ok");
    },
    { context: (_request, _env, ctx) => ctx },
  ),
};
```

For config-only ambient retention inside a known invocation, install
`config({ host: workers({ ctx }) })`.

## Worker entry

Run `crux runtime generate`, then create one host from
`cloudflare/_crux/generated.ts`, export its Durable Object class, and delegate
Worker requests to its router:

```ts
import { createCloudflareEvalHost } from "@use-crux/cloudflare";
import { deployedEvals, runtimeTargets } from "./_crux/generated";

interface Env {
  CRUX_EVAL_HOST: DurableObjectNamespace;
  CRUX_EVAL_HOST_TOKEN: string;
}

const host = createCloudflareEvalHost<Env>({
  binding: "CRUX_EVAL_HOST",
  deploymentId: "production-eu",
  registry: deployedEvals,
  targets: runtimeTargets,
  token: (env) => env.CRUX_EVAL_HOST_TOKEN,
});

export const CruxEvalHost = host.DurableObject;
export default { fetch: host.fetch };
```

Bind `CRUX_EVAL_HOST` to `CruxEvalHost` in Wrangler and store the dedicated
Eval-execute bearer as the `CRUX_EVAL_HOST_TOKEN` secret. Do not reuse browser,
Devtools, feedback, or ingest credentials.

The default result store canonicalizes and chunks payloads inside Durable
Object storage. To use R2, provide an explicit `resultPayloads` factory that
implements Core's `RuntimeResultPayloadPort`; work records still commit only
the content-addressed result reference.

Jobs are recovered through Durable Object alarms. `waitUntil()` and Cloudflare
Queues are not part of the correctness path.

Point the local coordinator at this deployment with
`CRUX_EVAL_HOST_URL`, `CRUX_EVAL_HOST_DEPLOYMENT_ID`, and the secret
`CRUX_EVAL_HOST_TOKEN`. Cloudflare connection values are not inferred. The
token must stay in environment/platform secrets and must not appear in config,
generated registries, CLI arguments, plans, logs, errors, or fingerprints.

## Runtime declaration

Declare the host in `crux.config.ts` with `cloudflare()`. The returned value is
inert outside the generated Worker entry and fails with the standard
host-only diagnostic if executed elsewhere.

```ts
import { config } from "@use-crux/core";
import { cloudflare } from "@use-crux/cloudflare";

export default config({ runtime: cloudflare() });
```

See the [Cloudflare Workers Eval host guide](https://cruxjs.dev/docs/guides/evals/runtime-hosts#cloudflare-workers)
for generated-entry and deployment setup.
