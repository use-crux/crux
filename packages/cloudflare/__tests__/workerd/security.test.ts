import { env, runDurableObjectAlarm, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    CRUX_EVAL_HOST: DurableObjectNamespace;
  }
}

describe("Cloudflare Eval host admission", () => {
  it("rejects stale identity before scheduling an alarm", async () => {
    const body = await deployedJob("job-stale");
    const response = await authorizedFetch("/jobs", {
      method: "POST",
      body: JSON.stringify({ ...body, caseFingerprint: "stale" }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { phase: "admission", retryable: false },
    });

    expect(await runDurableObjectAlarm(stub())).toBe(false);
  });

  it("enforces the configured concurrency limit inside the Durable Object", async () => {
    const first = await deployedJob("job-capacity-first");
    const second = { ...first, jobId: "job-capacity-second" };
    const accepted = await authorizedFetch("/jobs", post(first));
    const limited = await authorizedFetch("/jobs", post(second));

    expect(accepted.status).toBe(202);
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({
      error: { code: "EVAL_HOST_CONCURRENCY_LIMIT" },
    });
    await accepted.text();
    expect(await runDurableObjectAlarm(stub())).toBe(true);
  });
});

function stub() {
  return env.CRUX_EVAL_HOST.get(env.CRUX_EVAL_HOST.idFromName("production-eu"));
}

async function deployedJob(jobId: string) {
  const manifest = (await (await authorizedFetch("/manifest")).json()) as {
    evals: Array<{
      id: string;
      evalFingerprint: string;
      cases: Record<string, string>;
      variants: Record<string, string>;
    }>;
  };
  const entry = manifest.evals[0]!;
  return {
    protocol: "crux.eval-host.v2",
    jobId,
    evalRunId: `run-${jobId}`,
    evalId: entry.id,
    evalFingerprint: entry.evalFingerprint,
    caseId: "refund",
    caseFingerprint: entry.cases.refund,
    variant: "current",
    variantFingerprint: entry.variants.current,
    trial: 0,
    deadlineAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    deadline: { source: "host", limitMs: 10 * 60_000 },
  };
}

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

function post(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}
