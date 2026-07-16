import { describe, expect, it, vi } from "vitest";
import {
  createNodeEvalHost,
  createServerlessEvalHost,
  type EvalHostFetchHandler,
} from "../../../../src/runtime/eval-host";
import {
  genericQueue,
  inMemoryRuntimeStore,
  serverless,
  type RuntimeWakeMessage,
  type RuntimeStoreAdapter,
} from "@use-crux/core/runtime";
import {
  authorizedRequest,
  fixtureRegistry,
  jobBody,
  NOW,
  pollUntilTerminal,
  post,
  TOKEN,
} from "../fixture";

interface HostHarness {
  readonly host: EvalHostFetchHandler;
  readonly registry: ReturnType<typeof fixtureRegistry>;
  readonly store: RuntimeStoreAdapter;
  deliverQueued(): Promise<void>;
}

type Execute = (input: unknown) => Promise<{ output: unknown }>;

const adapters = [
  {
    name: "node",
    create(execute?: Execute): HostHarness {
      const registry = fixtureRegistry(execute);
      const store = inMemoryRuntimeStore();
      return {
        host: createNodeEvalHost({
          deploymentId: "production-eu",
          token: TOKEN,
          registry,
          store,
          now: () => NOW,
        }),
        registry,
        store,
        deliverQueued: async () => undefined,
      };
    },
  },
  {
    name: "serverless",
    create(execute?: Execute): HostHarness {
      const messages: RuntimeWakeMessage[] = [];
      const memory = inMemoryRuntimeStore();
      const store = Object.freeze({ ...memory, id: "durable-fake" as const });
      const runtime = serverless({
        store,
        publicUrl: "https://runtime.example",
        namespace: "production-eu",
        wake: genericQueue({
          secret: "runtime-wake-capability-32-bytes",
          enqueue: async (message) => {
            messages.push(message);
          },
        }),
      });
      const registry = fixtureRegistry(execute);
      const host = createServerlessEvalHost({
        deploymentId: "production-eu",
        token: TOKEN,
        registry,
        runtime,
        now: () => NOW,
      });
      return {
        host,
        registry,
        store,
        async deliverQueued() {
          for (const message of messages.splice(0)) {
            const response = await host.wake(
              new Request(message.url, {
                method: "POST",
                headers: message.headers,
                body: message.body,
              }),
            );
            expect(response.status).toBe(200);
          }
        },
      };
    },
  },
] as const;

describe.each(adapters)("$name Eval host adapter", ({ create }) => {
  it("keeps the sorted deployment manifest authenticated", async () => {
    const harness = create();

    await expect(
      harness.host.fetch(new Request("https://runtime.example/manifest")),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      (await harness.host.fetch(authorizedRequest("/manifest"))).json(),
    ).resolves.toMatchObject({
      evals: [
        {
          id: "support",
          cases: {
            account: expect.any(String),
            refund: expect.any(String),
          },
          variants: {
            alpha: expect.any(String),
            current: expect.any(String),
            zeta: expect.any(String),
          },
        },
      ],
    });
  });

  it("executes one exact deployed Case through the shared protocol", async () => {
    const harness = create();
    const body = jobBody(harness.registry);

    const accepted = await harness.host.fetch(
      authorizedRequest("/jobs", post(body)),
    );
    expect(accepted.status).toBe(202);
    await harness.deliverQueued();

    await expect(
      pollUntilTerminal(harness.host, body.jobId),
    ).resolves.toMatchObject({
      status: "succeeded",
      jobId: body.jobId,
      result: {
        output: { message: "Can I get a refund?" },
      },
    });
  });

  it("reconnects identical jobs and rejects conflicting reuse", async () => {
    const execute = vi.fn(async (input: unknown) => ({ output: input }));
    const harness = create(execute);
    const body = jobBody(harness.registry);

    await harness.host.fetch(authorizedRequest("/jobs", post(body)));
    await harness.deliverQueued();
    await pollUntilTerminal(harness.host, body.jobId);
    const duplicate = await harness.host.fetch(
      authorizedRequest("/jobs", post(body)),
    );
    const conflict = await harness.host.fetch(
      authorizedRequest("/jobs", post({ ...body, trial: 1 })),
    );

    expect(duplicate.status).toBe(200);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects stale identity before work admission or task execution", async () => {
    const execute = vi.fn(async (input: unknown) => ({ output: input }));
    const harness = create(execute);
    const body = { ...jobBody(harness.registry), caseFingerprint: "stale" };

    const response = await harness.host.fetch(
      authorizedRequest("/jobs", post(body)),
    );

    expect(response.status).toBe(409);
    expect(execute).not.toHaveBeenCalled();
    await expect(
      harness.store.state.countWork({ namespace: "eval-host:production-eu" }),
    ).resolves.toEqual([]);
  });

  it("redacts task failures behind the stable terminal projection", async () => {
    const harness = create(async () => {
      throw new Error("provider-secret");
    });
    const body = jobBody(harness.registry);

    await harness.host.fetch(authorizedRequest("/jobs", post(body)));
    await harness.deliverQueued();
    const failed = await pollUntilTerminal(harness.host, body.jobId);

    expect(failed).toMatchObject({
      status: "failed",
      error: { code: "EVAL_JOB_EXECUTION_FAILED", phase: "execute" },
    });
    expect(JSON.stringify(failed)).not.toContain("provider-secret");
  });

  it("cancels running work without exposing terminal evidence", async () => {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = create(async (input) => {
      markStarted();
      await gate;
      return { output: input };
    });
    const body = jobBody(harness.registry);

    await harness.host.fetch(authorizedRequest("/jobs", post(body)));
    const delivery = harness.deliverQueued();
    await started;
    const cancelled = await harness.host.fetch(
      authorizedRequest(`/jobs/${body.jobId}`, { method: "DELETE" }),
    );
    release();
    await delivery;

    expect(cancelled.status).toBe(200);
    await expect(
      pollUntilTerminal(harness.host, body.jobId),
    ).resolves.toMatchObject({
      status: "cancelled",
      revision: 3,
    });
  });
});
