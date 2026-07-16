import { describe, expect, it, vi } from "vitest";
import { createMemoryEvalHost } from "../../../src/runtime/eval-host";
import { canonicalRuntimeResult } from "../../../src/runtime/results/canonical";
import { RUNTIME_RESULT_MAX_BYTES } from "../../../src/runtime/results/types";
import {
  authorizedRequest,
  fixtureRegistry,
  jobBody,
  NOW,
  pollUntilTerminal,
  post,
  TOKEN,
} from "./fixture";

describe("memory Eval host security and limits", () => {
  it("requires auth on every job route, HTTPS outside loopback, and emits no CORS access", async () => {
    const registry = fixtureRegistry();
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      now: () => NOW,
    });
    const body = jobBody(registry);
    for (const request of [
      new Request("https://runtime.example/jobs", post(body)),
      new Request(`https://runtime.example/jobs/${body.jobId}`),
      new Request(`https://runtime.example/jobs/${body.jobId}`, {
        method: "DELETE",
      }),
    ]) {
      const response = await host.fetch(request);
      expect(response.status).toBe(401);
      expect(response.headers.has("access-control-allow-origin")).toBe(false);
    }
    const insecure = await host.fetch(
      new Request("http://runtime.example/manifest", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(insecure.status).toBe(400);
    await expect(insecure.json()).resolves.toMatchObject({
      error: { code: "EVAL_HOST_HTTPS_REQUIRED" },
    });
  });

  it("enforces concurrency and poll-rate limits without changing job truth", async () => {
    let release!: () => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async (input: unknown) => {
      started();
      await gate;
      return { output: input };
    });
    const registry = fixtureRegistry(execute);
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      now: () => NOW,
      limits: { maxConcurrentJobs: 1, maxPollsPerSecond: 1 },
    });
    const first = jobBody(registry);
    await host.fetch(authorizedRequest("/jobs", post(first)));
    await running;
    const second = { ...first, jobId: "job-second", evalRunId: "eval-run-2" };
    const capacity = await host.fetch(authorizedRequest("/jobs", post(second)));
    expect(capacity.status).toBe(429);
    await expect(capacity.json()).resolves.toMatchObject({
      error: { code: "EVAL_HOST_CONCURRENCY_LIMIT" },
    });
    expect(
      (await host.fetch(authorizedRequest(`/jobs/${first.jobId}`))).status,
    ).toBe(200);
    const rate = await host.fetch(authorizedRequest(`/jobs/${first.jobId}`));
    expect(rate.status).toBe(429);
    release();
  });

  it("accepts a large bounded result and fails closed after its payload disappears", async () => {
    const registry = fixtureRegistry(async () => ({
      output: "x".repeat(900_000),
    }));
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      now: () => NOW,
    });
    const body = jobBody(registry);
    await host.fetch(authorizedRequest("/jobs", post(body)));
    const succeeded = await pollUntilTerminal(host, body.jobId);
    expect(succeeded).toMatchObject({ status: "succeeded" });
    const ref = succeeded.resultRef as Parameters<
      typeof host.store.results.delete
    >[0];
    await host.store.results.delete(ref);
    await expect(
      (await host.fetch(authorizedRequest(`/jobs/${body.jobId}`))).json(),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "EVAL_RESULT_INTEGRITY_FAILED", phase: "result" },
    });
  });

  it("accepts exactly 1 MiB of normalized evidence through host execution", async () => {
    let output = "";
    const registry = fixtureRegistry(async () => ({ output }));
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      now: () => NOW,
    });
    const probe = jobBody(registry);
    await host.fetch(authorizedRequest("/jobs", post(probe)));
    const probeStatus = await pollUntilTerminal(host, probe.jobId);
    const probePayload = probeStatus.result as Parameters<
      typeof canonicalRuntimeResult
    >[0];
    const fixedBytes = canonicalRuntimeResult(probePayload).bytes.byteLength;
    output = "x".repeat(RUNTIME_RESULT_MAX_BYTES - fixedBytes);

    const exact = {
      ...probe,
      jobId: "job-support-refund-current-1",
      evalRunId: "eval-run-2",
    };
    await host.fetch(authorizedRequest("/jobs", post(exact)));
    const status = await pollUntilTerminal(host, exact.jobId);

    expect(status).toMatchObject({
      status: "succeeded",
      resultRef: { size: RUNTIME_RESULT_MAX_BYTES },
    });
  });

  it("classifies inline binary output as non-durable media", async () => {
    const registry = fixtureRegistry(async () => ({
      output: new Uint8Array([1, 2, 3]),
    }));
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      now: () => NOW,
    });
    const body = jobBody(registry);
    await host.fetch(authorizedRequest("/jobs", post(body)));
    await expect(pollUntilTerminal(host, body.jobId)).resolves.toMatchObject({
      status: "failed",
      error: { code: "EVAL_RESULT_MEDIA_NOT_DURABLE", phase: "result" },
    });
  });
});
