import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveNodeEvalHostConnection } from "../../../src/eval/node/host/connection";
import { attachEvalHostConnectionInference } from "../../../src/runtime/eval-host";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("Node Eval host connection discovery", () => {
  it("resolves fields independently from process, files, then adapter inference", async () => {
    const root = await temporaryRoot();
    await writeFile(
      join(root, ".env.local"),
      "CRUX_EVAL_HOST_DEPLOYMENT_ID=file-deployment\nCRUX_EVAL_HOST_TOKEN=file-token\n",
    );
    const environment = {
      CRUX_EVAL_HOST_URL: "https://explicit.example.test/runtime",
    };
    const before = { ...environment };
    const runtime = attachEvalHostConnectionInference(hostDefinition(), {
      infer: () => ({
        url: "https://inferred.example.test",
        deploymentId: "inferred-deployment",
      }),
    });

    const result = await resolveNodeEvalHostConnection({
      projectRoot: root,
      processEnvironment: environment,
      runtime,
      transport: vi.fn(),
    });

    expect(environment).toEqual(before);
    expect(result).toMatchObject({
      status: "connected",
      deploymentId: "file-deployment",
    });
  });

  it("does not construct or call a transport when the dedicated token is missing", async () => {
    const transport = vi.fn();
    const result = await resolveNodeEvalHostConnection({
      projectRoot: await temporaryRoot(),
      processEnvironment: {
        CRUX_EVAL_HOST_URL: "https://runtime.example.test",
        CRUX_EVAL_HOST_DEPLOYMENT_ID: "production",
      },
      transport,
    });

    expect(result).toEqual({
      status: "unverified",
      reason: "connection_unavailable",
      remedies: ["Set CRUX_EVAL_HOST_TOKEN."],
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("prefers .env.local, then .env.dev, then .env without mutating process state", async () => {
    const root = await temporaryRoot();
    await Promise.all([
      writeFile(
        join(root, ".env"),
        "CRUX_EVAL_HOST_URL=https://base.example.test\nCRUX_EVAL_HOST_DEPLOYMENT_ID=base\nCRUX_EVAL_HOST_TOKEN=base-token\n",
      ),
      writeFile(
        join(root, ".env.dev"),
        "CRUX_EVAL_HOST_URL=https://dev.example.test\nCRUX_EVAL_HOST_DEPLOYMENT_ID=dev\n",
      ),
      writeFile(join(root, ".env.local"), "CRUX_EVAL_HOST_TOKEN=local-token\n"),
    ]);
    const transport = vi.fn(async (request: Request) => {
      expect(request.url).toBe("https://dev.example.test/manifest");
      expect(request.headers.get("authorization")).toBe("Bearer local-token");
      return Response.json(emptyManifest("dev"));
    });

    const result = await resolveNodeEvalHostConnection({
      projectRoot: root,
      processEnvironment: {},
      transport,
    });

    expect(result).toMatchObject({ status: "connected", deploymentId: "dev" });
    if (result.status === "connected") await result.client.manifest();
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    "http://runtime.example.test",
    "https://user:secret@runtime.example.test",
    "https://runtime.example.test?deployment=other",
    "https://runtime.example.test#other",
  ])("rejects unsafe host URL %s without retaining the token", async (url) => {
    const secret = "never-print-this-token";
    await expect(
      resolveNodeEvalHostConnection({
        projectRoot: await temporaryRoot(),
        processEnvironment: {
          CRUX_EVAL_HOST_URL: url,
          CRUX_EVAL_HOST_DEPLOYMENT_ID: "production",
          CRUX_EVAL_HOST_TOKEN: secret,
        },
      }),
    ).rejects.not.toThrow(secret);
  });
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "crux-eval-host-"));
  roots.push(root);
  return root;
}

function hostDefinition() {
  return {
    kind: "host-bound" as const,
    id: "fixture",
    host: "fixture",
    capabilities: {
      timers: { durable: true },
      wake: { atLeastOnce: true, signed: true, maxPayloadBytes: 1_024 },
      events: { durable: true, cursorReads: true },
      waiters: { durable: true },
      leases: { durable: true },
      live: { available: false },
      setup: { canCheck: true, canApply: false },
      deployment: {
        serverless: "supported" as const,
        edge: "supported" as const,
        multiProcess: "supported" as const,
      },
    },
  };
}

function emptyManifest(deploymentId: string) {
  return {
    protocol: "crux.eval-host.v1",
    deploymentId,
    hostKind: "memory",
    capabilities: ["result-ref"],
    resultMaxBytes: 1024 * 1024,
    evals: [],
  };
}
