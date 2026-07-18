import { describe, expect, it, vi } from "vitest";
import { createMemoryEvalHost } from "../../../src/runtime/eval-host";
import {
  authorizedRequest,
  fixtureRegistry,
  jobBody,
  NOW,
  pollUntilTerminal,
  post,
  TOKEN,
} from "./fixture";

describe("memory Eval host conformance", () => {
  it("rejects every missing or stale deployed identity before inference or work admission", async () => {
    const execute = vi.fn(async (input: unknown) => ({ output: input }));
    const registry = fixtureRegistry(execute);
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      now: () => NOW,
    });
    const valid = jobBody(registry);
    const invalid = [
      { ...valid, evalId: "missing" },
      { ...valid, evalFingerprint: "stale" },
      { ...valid, caseId: "missing" },
      { ...valid, caseFingerprint: "stale" },
      { ...valid, variant: "missing" },
      { ...valid, variantFingerprint: "stale" },
    ];
    for (const [index, body] of invalid.entries()) {
      const response = await host.fetch(
        authorizedRequest("/jobs", post({ ...body, jobId: `stale-${index}` })),
      );
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { retryable: false, phase: "admission" },
      });
    }
    expect(execute).not.toHaveBeenCalled();
    await expect(
      host.store.state.countWork({ namespace: "eval-host:production-eu" }),
    ).resolves.toEqual([]);
  });

  it("rejects expired, excessive, unknown-field, and oversized submissions before inference", async () => {
    const execute = vi.fn(async (input: unknown) => ({ output: input }));
    const registry = fixtureRegistry(execute);
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      now: () => NOW,
    });
    const valid = jobBody(registry);
    const requests = [
      { ...valid, jobId: "expired", deadlineAt: "2026-07-16T18:00:00.000Z" },
      { ...valid, jobId: "too-far", deadlineAt: "2026-07-18T18:00:00.000Z" },
      { ...valid, jobId: "dynamic", input: { arbitrary: true } },
    ];
    for (const body of requests) {
      expect(
        (await host.fetch(authorizedRequest("/jobs", post(body)))).status,
      ).toBe(400);
    }
    const oversized = "x".repeat(17 * 1024);
    expect(
      (
        await host.fetch(
          authorizedRequest("/jobs", { method: "POST", body: oversized }),
        )
      ).status,
    ).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects missing host capabilities before inference or work admission", async () => {
    const execute = vi.fn(async (input: unknown) => ({ output: input }));
    const registry = fixtureRegistry(execute, ["asset-store"]);
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      now: () => NOW,
    });
    const response = await host.fetch(
      authorizedRequest("/jobs", post(jobBody(registry))),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "EVAL_HOST_CAPABILITY_UNSUPPORTED",
        retryable: false,
        phase: "admission",
      },
    });
    expect(execute).not.toHaveBeenCalled();
    await expect(
      host.store.state.countWork({ namespace: "eval-host:production-eu" }),
    ).resolves.toEqual([]);
  });

  it("redacts task failures and rejects oversized normalized results", async () => {
    const failing = fixtureRegistry(async () => {
      throw new Error("secret-provider-key");
    });
    const failedHost = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry: failing,
      now: () => NOW,
    });
    const failedBody = jobBody(failing);
    await failedHost.fetch(authorizedRequest("/jobs", post(failedBody)));
    const failure = await pollUntilTerminal(failedHost, failedBody.jobId);
    expect(failure).toMatchObject({
      status: "failed",
      error: {
        code: "EVAL_JOB_EXECUTION_FAILED",
        retryable: false,
        phase: "execute",
      },
    });
    expect(JSON.stringify(failure)).not.toContain("secret-provider-key");

    const oversized = fixtureRegistry(async () => ({
      output: "x".repeat(1024 * 1024),
    }));
    const oversizedHost = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry: oversized,
      now: () => NOW,
    });
    const oversizedBody = jobBody(oversized);
    await oversizedHost.fetch(authorizedRequest("/jobs", post(oversizedBody)));
    await expect(
      pollUntilTerminal(oversizedHost, oversizedBody.jobId),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "EVAL_RESULT_TOO_LARGE", phase: "result" },
    });
  });

  it("cancels admitted work idempotently and never exposes a result", async () => {
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
    });
    const body = jobBody(registry);
    await host.fetch(authorizedRequest("/jobs", post(body)));
    await running;
    const first = await host.fetch(
      authorizedRequest(`/jobs/${body.jobId}`, { method: "DELETE" }),
    );
    expect(first.status).toBe(200);
    const second = await host.fetch(
      authorizedRequest(`/jobs/${body.jobId}`, { method: "DELETE" }),
    );
    expect(second.status).toBe(200);
    release();
    await expect(pollUntilTerminal(host, body.jobId)).resolves.toMatchObject({
      status: "cancelled",
      revision: 3,
    });
  });
});
