import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { WorkId } from "@use-crux/core/runtime";
import { createCloudflareRuntimeStore } from "../../src/runtime/store";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    CRUX_EVAL_HOST: DurableObjectNamespace;
  }
}

describe("Cloudflare Eval job lifecycle", () => {
  it("deduplicates admission and preserves terminal evidence across eviction", async () => {
    const job = await deployedJob("job-restart-redelivery");
    const accepted = await authorizedFetch("/jobs", post(job));
    const duplicate = await authorizedFetch("/jobs", post(job));
    const conflict = await authorizedFetch("/jobs", post({ ...job, trial: 1 }));

    expect(accepted.status).toBe(202);
    expect(duplicate.status).toBe(200);
    expect(conflict.status).toBe(409);
    await Promise.all([accepted.text(), duplicate.text(), conflict.text()]);

    const stub = env.CRUX_EVAL_HOST.get(
      env.CRUX_EVAL_HOST.idFromName("production-eu"),
    );
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await evictDurableObject(stub);

    await expect(
      (await authorizedFetch(`/jobs/${job.jobId}`)).json(),
    ).resolves.toMatchObject({
      status: "succeeded",
      result: { output: { message: "Can I get a refund?" } },
    });
    expect((await authorizedFetch("/jobs", post(job))).status).toBe(200);
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });

  it("cancels admitted work before alarm execution without terminal evidence", async () => {
    const job = await deployedJob("job-cancel-before-alarm");
    const accepted = await authorizedFetch("/jobs", post(job));
    expect(accepted.status).toBe(202);
    await accepted.text();

    const cancelled = await authorizedFetch(`/jobs/${job.jobId}`, {
      method: "DELETE",
    });
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toMatchObject({
      status: "cancelled",
    });

    const stub = env.CRUX_EVAL_HOST.get(
      env.CRUX_EVAL_HOST.idFromName("production-eu"),
    );
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await expect(
      (await authorizedFetch(`/jobs/${job.jobId}`)).json(),
    ).resolves.toMatchObject({ status: "cancelled" });
  });

  it("reclaims an expired isolate lease before redelivering its alarm", async () => {
    const job = await deployedJob("job-expired-isolate-lease");
    const accepted = await authorizedFetch("/jobs", post(job));
    expect(accepted.status).toBe(202);
    await accepted.text();

    const stub = env.CRUX_EVAL_HOST.get(
      env.CRUX_EVAL_HOST.idFromName("production-eu"),
    );
    await runInDurableObject(stub, async (_instance, state) => {
      const store = createCloudflareRuntimeStore(state.storage);
      const workId = `eval-job:${job.jobId}` as WorkId;
      const work = await store.state.getWork(workId, {
        namespace: "eval-host:production-eu",
      });
      expect(work).not.toBeNull();
      const lease = await store.leases.claim(`work:${workId}`, { ttlMs: -1 });
      expect(lease).not.toBeNull();
      await store.state.putWork({
        ...work!,
        status: "leased",
        leaseToken: lease!.token,
      });
    });

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await expect(
      (await authorizedFetch(`/jobs/${job.jobId}`)).json(),
    ).resolves.toMatchObject({
      status: "succeeded",
      result: { output: { message: "Can I get a refund?" } },
    });
  });
});

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
    protocol: "crux.eval-host.v1",
    jobId,
    evalRunId: `run-${jobId}`,
    evalId: entry.id,
    evalFingerprint: entry.evalFingerprint,
    caseId: "refund",
    caseFingerprint: entry.cases.refund,
    variant: "current",
    variantFingerprint: entry.variants.current,
    trial: 0,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
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
