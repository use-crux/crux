import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNodeEvalHostDeployment,
  createNodeEvalHostReadiness,
  createNodeEvalHostRuntime,
  pollEvalHostJobForInternalUse,
} from "../../../src/eval/node/host/readiness";
import type {
  EvalHostClient,
  EvalHostJobStatusV1,
} from "../../../src/runtime/eval-host";
import {
  createEvalHostClient,
  createMemoryEvalHost,
  EvalHostClientTransportError,
} from "../../../src/runtime/eval-host";
import {
  connectionEnvironment,
  hydratedEntry,
  manifest,
  registry,
} from "./fixture";

afterEach(() => {
  vi.useRealTimers();
});

describe("Node Eval host manifest readiness", () => {
  it("polls until the admitted deadline instead of a fixed attempt count", async () => {
    let now = 0;
    let polls = 0;
    const accepted: EvalHostJobStatusV1 = {
      jobId: "job-1",
      evalRunId: "run-1",
      attempt: 1,
      revision: 1,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      status: "accepted",
    };
    const succeeded: EvalHostJobStatusV1 = {
      ...accepted,
      status: "succeeded",
      resultRef: {
        sha256: "a".repeat(64),
        size: 2,
        mediaType: "application/vnd.crux.eval-result+json",
        location: "memory://results/result-1",
      },
      result: {},
    };
    const transport = vi.fn(async () =>
      Response.json(++polls > 150 ? succeeded : accepted),
    );
    const client = createEvalHostClient({
      baseUrl: "https://runtime.example/",
      token: "poll-token-that-must-not-be-retained",
      transport,
    });

    await expect(
      pollEvalHostJobForInternalUse(client, accepted, 20_000, {
        now: () => now,
        sleep: async (durationMs) => {
          now += durationMs;
        },
        pollIntervalMs: 100,
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(transport).toHaveBeenCalledTimes(151);
  });

  it("does not start another poll after sleeping through the admitted deadline", async () => {
    let now = 0;
    const accepted: EvalHostJobStatusV1 = {
      jobId: "job-1",
      evalRunId: "run-1",
      attempt: 1,
      revision: 1,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      status: "accepted",
    };
    const client = {
      poll: vi.fn(),
    } as unknown as EvalHostClient;

    await expect(
      pollEvalHostJobForInternalUse(client, accepted, 25, {
        now: () => now,
        sleep: async (durationMs) => {
          now += durationMs;
        },
        pollIntervalMs: 100,
      }),
    ).resolves.toBe(accepted);
    expect(client.poll).not.toHaveBeenCalled();
  });

  it("bounds an in-flight poll by the remaining admitted deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const accepted: EvalHostJobStatusV1 = {
      jobId: "job-1",
      evalRunId: "run-1",
      attempt: 1,
      revision: 1,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      status: "accepted",
    };
    const client = createEvalHostClient({
      baseUrl: "https://runtime.example/",
      token: "poll-token-that-must-not-be-retained",
      requestTimeoutMs: 1_000,
      transport: () => new Promise<Response>(() => undefined),
    });
    const pending = pollEvalHostJobForInternalUse(client, accepted, 25, {
      pollIntervalMs: 0,
    });

    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toBe(accepted);
    vi.useRealTimers();
  });

  it("surfaces a shorter per-request timeout while overall time remains", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const accepted: EvalHostJobStatusV1 = {
      jobId: "job-1",
      evalRunId: "run-1",
      attempt: 1,
      revision: 1,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      status: "accepted",
    };
    const client = createEvalHostClient({
      baseUrl: "https://runtime.example/",
      token: "poll-token-that-must-not-be-retained",
      requestTimeoutMs: 1_000,
      transport: () => new Promise<Response>(() => undefined),
    });
    const pending = pollEvalHostJobForInternalUse(client, accepted, 1_000, {
      pollIntervalMs: 0,
      requestTimeoutMs: 10,
    });
    void pending.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).rejects.toMatchObject({
      name: "EvalHostClientTransportError",
      code: "EVAL_HOST_REQUEST_TIMEOUT",
      operation: "poll",
    } satisfies Partial<EvalHostClientTransportError>);
    vi.useRealTimers();
  });

  it("memoizes one authenticated manifest across all remote cells", async () => {
    const entry = hydratedEntry();
    const transport = vi.fn(async () =>
      Response.json(manifest(entry, "production")),
    );
    const provider = createNodeEvalHostReadiness({
      entry,
      projectRoot: "/does-not-read-files",
      processEnvironment: connectionEnvironment(),
      transport,
    });
    const work = [
      {
        caseId: "refund",
        variant: "current",
        trial: 0,
        capabilities: ["record-store"],
      },
      {
        caseId: "refund",
        variant: "current",
        trial: 1,
        capabilities: ["record-store"],
      },
    ];

    await expect(provider.resolve(work)).resolves.toEqual({
      status: "verified",
      deploymentId: "production",
      hostKind: "memory",
    });
    await expect(provider.resolve(work)).resolves.toMatchObject({
      status: "verified",
    });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[0].headers.get("authorization")).toBe(
      "Bearer top-secret-token",
    );
  });

  it("rejects a deployment generated with a stale redaction policy", async () => {
    const entry = hydratedEntry();
    const provider = createNodeEvalHostReadiness({
      entry,
      projectRoot: "/does-not-read-files",
      processEnvironment: connectionEnvironment(),
      persistencePolicy: { redactPaths: ["customer.email"] },
      transport: async () => Response.json(manifest(entry, "production")),
    });

    await expect(provider.resolve([])).resolves.toMatchObject({
      status: "mismatch",
      reason: expect.stringContaining("observability.redactPaths"),
    });
  });

  it("shares one authenticated manifest across every Eval in one invocation", async () => {
    const first = hydratedEntry();
    const second = Object.freeze({ ...first, id: "support-two" });
    const firstManifest = manifest(first, "production");
    const transport = vi.fn(async () =>
      Response.json({
        ...firstManifest,
        evals: [
          ...firstManifest.evals,
          { ...firstManifest.evals[0]!, id: second.id },
        ],
      }),
    );
    const deployment = createNodeEvalHostDeployment({
      projectRoot: "/does-not-read-files",
      processEnvironment: connectionEnvironment(),
      transport,
    });

    const firstRuntime = createNodeEvalHostRuntime({
      entry: first,
      projectRoot: "/does-not-read-files",
      deployment,
    });
    const secondRuntime = createNodeEvalHostRuntime({
      entry: second,
      projectRoot: "/does-not-read-files",
      deployment,
    });

    await expect(firstRuntime.readiness.resolve([])).resolves.toMatchObject({
      status: "verified",
    });
    await expect(secondRuntime.readiness.resolve([])).resolves.toMatchObject({
      status: "verified",
    });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("does not trust a manifest that declares a different deployment identity", async () => {
    const entry = hydratedEntry();
    const provider = createNodeEvalHostReadiness({
      entry,
      projectRoot: "/does-not-read-files",
      processEnvironment: connectionEnvironment(),
      transport: async () =>
        Response.json(manifest(entry, "attacker-selected")),
    });

    await expect(provider.resolve([])).resolves.toMatchObject({
      status: "mismatch",
      reason: expect.stringContaining(
        "Expected Runtime deployment 'production'",
      ),
    });
  });

  it("treats an authenticated incompatible protocol as a hard mismatch", async () => {
    const entry = hydratedEntry();
    const provider = createNodeEvalHostReadiness({
      entry,
      projectRoot: "/does-not-read-files",
      processEnvironment: connectionEnvironment(),
      transport: async () =>
        Response.json({
          ...manifest(entry, "production"),
          protocol: "crux.eval-host.v2",
        }),
    });

    await expect(provider.resolve([])).resolves.toMatchObject({
      status: "mismatch",
      reason: expect.stringContaining("protocol"),
    });
  });

  it("rejects redirects without following them", async () => {
    const entry = hydratedEntry();
    const transport = vi.fn(async (request: Request) => {
      expect(request.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: "https://other.example.test/manifest" },
      });
    });
    const provider = createNodeEvalHostReadiness({
      entry,
      projectRoot: "/does-not-read-files",
      processEnvironment: connectionEnvironment(),
      transport,
    });

    await expect(provider.resolve([])).resolves.toMatchObject({
      status: "unverified",
      reason: "transport",
    });
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "missing Eval",
      (value: ReturnType<typeof manifest>) => ({ ...value, evals: [] }),
    ],
    [
      "stale Eval fingerprint",
      (value: ReturnType<typeof manifest>) => ({
        ...value,
        evals: [{ ...value.evals[0]!, evalFingerprint: "stale" }],
      }),
    ],
    [
      "stale Case sidecar",
      (value: ReturnType<typeof manifest>) => ({
        ...value,
        evals: [{ ...value.evals[0]!, cases: { refund: "stale" } }],
      }),
    ],
    [
      "stale Variant",
      (value: ReturnType<typeof manifest>) => ({
        ...value,
        evals: [{ ...value.evals[0]!, variants: { current: "stale" } }],
      }),
    ],
    [
      "missing capability",
      (value: ReturnType<typeof manifest>) => ({
        ...value,
        capabilities: ["result-ref"],
      }),
    ],
    [
      "insufficient result ceiling",
      (value: ReturnType<typeof manifest>) => ({ ...value, resultMaxBytes: 1 }),
    ],
  ])("rejects a proven %s before admission", async (_label, change) => {
    const entry = hydratedEntry();
    const provider = createNodeEvalHostReadiness({
      entry,
      projectRoot: "/does-not-read-files",
      processEnvironment: connectionEnvironment(),
      transport: async () =>
        Response.json(change(manifest(entry, "production"))),
    });

    await expect(provider.resolve([])).resolves.toMatchObject({
      status: "mismatch",
      remedy: expect.stringContaining("runtime generate"),
    });
  });

  it("executes required-host work through the verified selected Runtime", async () => {
    const entry = hydratedEntry();
    const host = createMemoryEvalHost({
      deploymentId: "production",
      token: "top-secret-token-that-is-at-least-32-bytes",
      hostCapabilities: ["record-store"],
      registry: registry(entry),
    });
    const runtime = createNodeEvalHostRuntime({
      entry,
      projectRoot: "/does-not-read-files",
      processEnvironment: {
        ...connectionEnvironment(),
        CRUX_EVAL_HOST_TOKEN: "top-secret-token-that-is-at-least-32-bytes",
      },
      transport: (request) => host.fetch(request),
    });

    await expect(runtime.readiness.resolve([])).resolves.toMatchObject({
      status: "verified",
    });
    await expect(
      runtime.execute({
        evalId: "support",
        caseId: "refund",
        variant: "current",
        trial: 0,
        task: entry.eval,
        overrides: {},
        input: { question: "refund" },
      }),
    ).resolves.toMatchObject({
      output: "yes",
      metrics: { durationMs: expect.any(Number) },
    });
  });
});
