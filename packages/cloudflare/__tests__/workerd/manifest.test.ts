import { env, runDurableObjectAlarm, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    CRUX_EVAL_HOST: DurableObjectNamespace;
  }
}

describe("Cloudflare Eval host", () => {
  it("keeps the deployment manifest behind the dedicated bearer", async () => {
    const unauthorized = await SELF.fetch("https://worker.test/manifest");
    const authorized = await SELF.fetch("https://worker.test/manifest", {
      headers: {
        authorization: "Bearer eval-execute-capability-token-32-bytes",
      },
    });

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toMatchObject({
      deploymentId: "production-eu",
      hostKind: "cloudflare",
      protocol: "crux.eval-host.v1",
    });
    expect(env.CRUX_EVAL_HOST).toBeDefined();
  });

  it("persists admission and executes it only through the Durable Object alarm", async () => {
    const manifestResponse = await authorizedFetch("/manifest");
    const manifest = (await manifestResponse.json()) as {
      evals: Array<{
        id: string;
        evalFingerprint: string;
        cases: Record<string, string>;
        variants: Record<string, string>;
      }>;
    };
    const entry = manifest.evals[0]!;
    const body = {
      protocol: "crux.eval-host.v1",
      jobId: "job-support-refund-current-0",
      evalRunId: "eval-run-1",
      evalId: entry.id,
      evalFingerprint: entry.evalFingerprint,
      caseId: "refund",
      caseFingerprint: entry.cases.refund,
      variant: "current",
      variantFingerprint: entry.variants.current,
      trial: 0,
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    };

    const accepted = await authorizedFetch("/jobs", {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(accepted.status).toBe(202);
    await expect(
      (await authorizedFetch(`/jobs/${body.jobId}`)).json(),
    ).resolves.toMatchObject({ status: "accepted" });

    const id = env.CRUX_EVAL_HOST.idFromName("production-eu");
    expect(await runDurableObjectAlarm(env.CRUX_EVAL_HOST.get(id))).toBe(true);

    await expect(
      (await authorizedFetch(`/jobs/${body.jobId}`)).json(),
    ).resolves.toMatchObject({
      status: "succeeded",
      result: {
        output: { message: "Can I get a refund?" },
      },
    });
  });
});

function authorizedFetch(path: string, init: RequestInit = {}) {
  return SELF.fetch(`https://worker.test${path}`, {
    ...init,
    headers: {
      authorization: "Bearer eval-execute-capability-token-32-bytes",
      "content-type": "application/json",
      ...init.headers,
    },
  });
}
