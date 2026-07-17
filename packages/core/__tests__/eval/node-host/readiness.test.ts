import { describe, expect, it, vi } from "vitest";
import {
  createNodeEvalHostReadiness,
  createNodeEvalHostRuntime,
} from "../../../src/eval/node/host/readiness";
import { createMemoryEvalHost } from "../../../src/runtime/eval-host";
import {
  connectionEnvironment,
  hydratedEntry,
  manifest,
  registry,
} from "./fixture";

describe("Node Eval host manifest readiness", () => {
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
