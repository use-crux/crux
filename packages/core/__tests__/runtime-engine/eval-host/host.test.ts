import { describe, expect, it, vi } from "vitest";
import {
  CRUX_EVAL_HOST_PROTOCOL,
  createEvalHostClient,
  createMemoryEvalHost,
} from "../../../src/runtime/eval-host";
import {
  authorizedRequest,
  fixtureRegistry,
  jobBody,
  NOW,
  pollUntilTerminal,
  post,
  TOKEN,
} from "./fixture";
import { fingerprintEvalValue } from "../../../src/eval/internal/identity";

describe("memory Eval host", () => {
  it("returns the authenticated, sorted deployed manifest without source content", async () => {
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry: fixtureRegistry(),
      now: () => NOW,
    });
    expect(
      (await host.fetch(new Request("https://runtime.example/manifest")))
        .status,
    ).toBe(401);
    const response = await host.fetch(authorizedRequest("/manifest"));
    expect(response.status).toBe(200);
    const raw = await response.clone().text();
    await expect(response.json()).resolves.toEqual({
      protocol: CRUX_EVAL_HOST_PROTOCOL,
      deploymentId: "production-eu",
      hostKind: "memory",
      privacyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      capabilities: ["result-ref"],
      resultMaxBytes: 1024 * 1024,
      evals: [
        {
          id: "support",
          evalFingerprint: "eval-support-v1",
          cases: {
            account: expect.stringMatching(/^[a-f0-9]{64}$/),
            refund: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
          variants: {
            alpha: expect.stringMatching(/^[a-f0-9]{64}$/),
            current: expect.stringMatching(/^[a-f0-9]{64}$/),
            zeta: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
          requiredHostCapabilities: [],
        },
      ],
    });
    expect(raw).not.toContain("refund policy");
    expect(raw).not.toContain("redactPaths");
  });

  it("fails closed before durable storage when project redaction would alter a result", async () => {
    const registry = fixtureRegistry(
      async () => ({
        output: { customer: { email: "private@example.test" } },
      }),
      [],
      "generate",
      ["customer.email"],
    );
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
      error: { code: "EVAL_RESULT_REDACTION_REQUIRED", phase: "result" },
    });
  });

  it("admits one deployed Case and exposes running then exact succeeded evidence", async () => {
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async (input: unknown) => {
      markStarted();
      await gate;
      return { output: input };
    });
    const registry = fixtureRegistry(execute, [], "stream");
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      now: () => NOW,
    });
    const body = jobBody(registry);
    const accepted = await host.fetch(authorizedRequest("/jobs", post(body)));
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({
      status: "accepted",
      jobId: body.jobId,
      revision: 1,
    });
    await started;
    await expect(
      (await host.fetch(authorizedRequest(`/jobs/${body.jobId}`))).json(),
    ).resolves.toMatchObject({
      status: "running",
      jobId: body.jobId,
      attempt: 1,
      revision: 2,
    });
    release();
    const succeeded = await pollUntilTerminal(host, body.jobId);
    expect(succeeded).toMatchObject({
      status: "succeeded",
      jobId: body.jobId,
      evalRunId: body.evalRunId,
      revision: 3,
      resultRef: {
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        size: expect.any(Number),
        mediaType: "application/vnd.crux.eval-result+json",
        location: expect.stringMatching(/^memory:/),
      },
      result: {
        schemaVersion: 1,
        protocol: CRUX_EVAL_HOST_PROTOCOL,
        jobId: body.jobId,
        evalRunId: body.evalRunId,
        output: { message: "Can I get a refund?" },
        response: { text: "Can I get a refund?" },
        capturedSignals: [],
        runIds: [expect.stringMatching(/^run_/)],
        observedIdentity: {
          reusable: true,
          fingerprint: fingerprintEvalValue({ adapter: "fixture-v1" }),
        },
      },
    });
    const result = (
      succeeded as {
        result: { response: { runId: string }; runIds: string[] };
      }
    ).result;
    expect(result.runIds).toEqual([result.response.runId]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("reconnects identical admissions and rejects a conflicting job ID", async () => {
    const execute = vi.fn(async (input: unknown) => ({ output: input }));
    const registry = fixtureRegistry(execute);
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      now: () => NOW,
    });
    const body = jobBody(registry);
    expect(
      (await host.fetch(authorizedRequest("/jobs", post(body)))).status,
    ).toBe(202);
    await pollUntilTerminal(host, body.jobId);
    const duplicate = await host.fetch(authorizedRequest("/jobs", post(body)));
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      status: "succeeded",
      jobId: body.jobId,
    });
    const conflict = await host.fetch(
      authorizedRequest("/jobs", post({ ...body, trial: 1 })),
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT", retryable: false },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("uses the narrow authenticated client transport", async () => {
    const registry = fixtureRegistry();
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      now: () => NOW,
    });
    const client = createEvalHostClient({
      baseUrl: "https://runtime.example/",
      token: TOKEN,
      transport: (request) => host.fetch(request),
    });
    await expect(client.manifest()).resolves.toMatchObject({
      deploymentId: "production-eu",
    });
    const body = jobBody(registry);
    await expect(client.submit(body)).resolves.toMatchObject({
      status: "accepted",
    });
    await pollUntilTerminal(host, body.jobId);
    await expect(client.poll(body.jobId)).resolves.toMatchObject({
      status: "succeeded",
    });
  });

  it("rejects unknown response fields at the client boundary", async () => {
    const client = createEvalHostClient({
      baseUrl: "https://runtime.example/",
      token: TOKEN,
      transport: async () =>
        new Response(
          JSON.stringify({
            protocol: CRUX_EVAL_HOST_PROTOCOL,
            deploymentId: "production-eu",
            hostKind: "memory",
            privacyFingerprint: "privacy-v1",
            capabilities: ["result-ref"],
            resultMaxBytes: 1024 * 1024,
            evals: [],
            unexpected: true,
          }),
          { status: 200 },
        ),
    });

    await expect(client.manifest()).rejects.toThrow("incompatible manifest");
  });
});
