import { describe, expect, it } from "vitest";
import { createRuntimeWithHostContext } from "@use-crux/core/runtime";
import {
  createConvexEvalHost,
  type ConvexEvalHostActions,
} from "../../../src/runtime-node";
import type { ConvexRuntimeComponent } from "../../../src/runtime";
import type { ConvexCruxStorageComponent } from "../../../src/store-component";
import { convex } from "../../../src/runtime";
import { getConvexCruxRuntime } from "../../../src/runtime";
import { fixtureRegistry, NOW, TOKEN } from "./fixture";
import { jobBody } from "./fixture";
import { createConvexEvalActionHarness } from "./action-harness";

const component = {
  memory: { get: {}, list: {}, set: {}, insert: {}, remove: {} },
  runtime: {
    state: {},
    events: {},
    waiters: {},
    timers: {},
    outbox: {},
    leases: {},
    results: { put: {}, get: {}, deleteResult: {}, pruneUnreferenced: {} },
    evalHost: { admit: {} },
  },
} satisfies ConvexRuntimeComponent & ConvexCruxStorageComponent;

describe("createConvexEvalHost()", () => {
  it("keeps the app deployable when the optional Eval bearer is not configured", async () => {
    const actions = createConvexEvalHost({
      component,
      registry: fixtureRegistry(),
      deploymentId: "production-eu",
      token: undefined as never,
      now: () => NOW,
    });
    const response = await invokeEvalRequest(
      actions.handleEvalRequest,
      {
        runMutation: async () => undefined,
        scheduler: { runAfter: async () => undefined },
      } as never,
      request("/manifest", "Bearer any-token"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "EVAL_HOST_SETUP_REQUIRED",
        message:
          "Crux Eval hosting is not configured for this Convex deployment.",
        nextStep:
          "Set CRUX_EVAL_HOST_TOKEN in this Convex deployment and in the environment that runs Crux Evals.",
      },
    });
  });

  it("exposes a Node action that transports an Eval HTTP envelope", async () => {
    const actions = createConvexEvalHost({
      component,
      registry: fixtureRegistry(),
      deploymentId: "production-eu",
      token: TOKEN,
      now: () => NOW,
    });
    const ctx = {
      runMutation: async () => {
        throw new Error("Manifest/auth reads must not touch durable state.");
      },
      vectorSearch: async () => [],
      scheduler: { runAfter: async () => undefined },
    };

    const result = await actions.handleEvalRequest._handler!(ctx as never, {
      request: await serializeRequest(request("/manifest", `Bearer ${TOKEN}`)),
    });

    expect(result.status).toBe(200);
    await expect(responseFrom(result).json()).resolves.toMatchObject({
      protocol: "crux.eval-host.v2",
      hostKind: "convex",
    });
  });

  it("keeps the Eval action capability separate from the local Runtime Bridge", async () => {
    const actions = createConvexEvalHost({
      component,
      registry: fixtureRegistry(),
      deploymentId: "production-eu",
      token: TOKEN,
      now: () => NOW,
      hostCapabilities: ["record-store", "search-store", "asset-store"],
    });
    const ctx = {
      runMutation: async () => {
        throw new Error("Manifest/auth reads must not touch durable state.");
      },
      vectorSearch: async () => [],
      scheduler: { runAfter: async () => undefined },
    };
    const unauthorized = await invokeEvalRequest(
      actions.handleEvalRequest,
      ctx as never,
      request("/manifest", "Bearer local-runtime-bridge"),
    );
    const authorized = await invokeEvalRequest(
      actions.handleEvalRequest,
      ctx as never,
      request("/manifest", `Bearer ${TOKEN}`),
    );

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toMatchObject({
      protocol: "crux.eval-host.v2",
      hostKind: "convex",
      privacyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      capabilities: ["record-store", "result-ref", "structured-timeout"],
      evals: [{ id: "support" }],
    });
  });

  it("survives action reconstruction and duplicate scheduled delivery with one result ref", async () => {
    const harness = createConvexEvalActionHarness();
    const registry = fixtureRegistry(async (input) => {
      await Promise.resolve();
      const nested = createRuntimeWithHostContext({
        runtime: convex(),
        startMaintenance: false,
      });
      nested.dispose();
      return { output: input };
    });
    const actions = createConvexEvalHost({
      component: harness.component,
      registry,
      deploymentId: "production-eu",
      token: TOKEN,
      hostCapabilities: ["record-store"],
      now: () => NOW,
    });
    const body = jobBody(registry);

    const admitted = await invokeEvalRequest(
      actions.handleEvalRequest,
      harness.ctx as never,
      request("/jobs", `Bearer ${TOKEN}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    expect(admitted.status).toBe(202);
    expect(harness.scheduled).toHaveLength(1);

    const reconstructed = createConvexEvalHost({
      component: harness.component,
      registry,
      deploymentId: "production-eu",
      token: TOKEN,
      now: () => NOW,
    });
    const envelope = harness.scheduled[0]!;
    await reconstructed.executeEvalTarget._handler!(harness.ctx as never, {
      envelope,
    });
    await reconstructed.executeEvalTarget._handler!(harness.ctx as never, {
      envelope,
    });

    const poll = await invokeEvalRequest(
      reconstructed.handleEvalRequest,
      harness.ctx as never,
      request(`/jobs/${body.jobId}`, `Bearer ${TOKEN}`),
    );
    expect(poll.status).toBe(200);
    await expect(poll.json()).resolves.toMatchObject({
      status: "succeeded",
      result: { output: { message: "Refund please" } },
      resultRef: { location: expect.stringMatching(/^convex:/) },
    });
    const work = await harness.memory.state.getWork(
      `eval-job:${body.jobId}` as never,
      {
        namespace: "eval-host:production-eu",
      },
    );
    expect(work).toMatchObject({
      status: "completed",
      resultRef: { location: expect.any(String) },
    });
    expect(work).not.toHaveProperty("result");
  });

  it("advertises and binds only registry-required storage that Convex supports", async () => {
    const harness = createConvexEvalActionHarness();
    const registry = fixtureRegistry(
      async () => ({
        output: {
          recordStoreBound: getConvexCruxRuntime()?.records !== undefined,
        },
      }),
      ["record-store"],
    );
    const actions = createConvexEvalHost({
      component: harness.component,
      registry,
      deploymentId: "production-eu",
      token: TOKEN,
      hostCapabilities: ["record-store", "asset-store"],
      now: () => NOW,
    });
    const manifest = await invokeEvalRequest(
      actions.handleEvalRequest,
      harness.ctx as never,
      request("/manifest", `Bearer ${TOKEN}`),
    );
    await expect(manifest.json()).resolves.toMatchObject({
      capabilities: ["record-store", "result-ref", "structured-timeout"],
    });

    const body = jobBody(registry);
    await invokeEvalRequest(
      actions.handleEvalRequest,
      harness.ctx as never,
      request("/jobs", `Bearer ${TOKEN}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    await actions.executeEvalTarget._handler!(harness.ctx as never, {
      envelope: harness.scheduled[0]!,
    });
    const completed = await invokeEvalRequest(
      actions.handleEvalRequest,
      harness.ctx as never,
      request(`/jobs/${body.jobId}`, `Bearer ${TOKEN}`),
    );
    await expect(completed.json()).resolves.toMatchObject({
      status: "succeeded",
      result: { output: { recordStoreBound: true } },
    });
  });

  it("rejects stale registry identity before durable admission", async () => {
    const harness = createConvexEvalActionHarness();
    const registry = fixtureRegistry();
    const actions = createConvexEvalHost({
      component: harness.component,
      registry,
      deploymentId: "production-eu",
      token: TOKEN,
      now: () => NOW,
    });
    const stale = { ...jobBody(registry), caseFingerprint: "stale" };

    const response = await invokeEvalRequest(
      actions.handleEvalRequest,
      harness.ctx as never,
      request("/jobs", `Bearer ${TOKEN}`, {
        method: "POST",
        body: JSON.stringify(stale),
      }),
    );

    expect(response.status).toBe(409);
    await expect(
      harness.memory.state.countWork({ namespace: "eval-host:production-eu" }),
    ).resolves.toEqual([]);
  });
});

function request(
  path: string,
  authorization: string,
  init: RequestInit = {},
): Request {
  return new Request(`https://convex.example${path}`, {
    ...init,
    headers: {
      authorization,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

async function serializeRequest(request: Request) {
  return {
    url: request.url,
    method: request.method,
    headers: [...request.headers.entries()].map(([name, value]) => ({
      name,
      value,
    })),
    body: await request.arrayBuffer(),
  };
}

function responseFrom(response: {
  status: number;
  statusText: string;
  headers: Array<{ name: string; value: string }>;
  body: ArrayBuffer;
}): Response {
  return new Response(response.body, {
    ...response,
    headers: response.headers.map(({ name, value }): [string, string] => [
      name,
      value,
    ]),
  });
}

async function invokeEvalRequest(
  action: ConvexEvalHostActions["handleEvalRequest"],
  ctx: never,
  request: Request,
): Promise<Response> {
  const response = await action._handler!(ctx, {
    request: await serializeRequest(request),
  });
  return responseFrom(response);
}
