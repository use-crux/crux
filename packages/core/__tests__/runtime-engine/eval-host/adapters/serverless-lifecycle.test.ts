import { describe, expect, it, vi } from "vitest";
import { createServerlessEvalHost } from "../../../../src/runtime/eval-host";
import {
  createRuntimeWithHostContext,
  genericQueue,
  inMemoryRuntimeStore,
  runWithRuntimeHost,
  serverless,
  type HostBoundRuntimeEngineDefinition,
  type RuntimeWakeMessage,
} from "@use-crux/core/runtime";
import {
  authorizedRequest,
  fixtureRegistry,
  HOST_CAPABILITIES,
  jobBody,
  NOW,
  pollUntilTerminal,
  post,
  TOKEN,
} from "../fixture";

const WAKE_SECRET = "runtime-wake-capability-32-bytes";

describe("serverless Eval host lifecycle", () => {
  it("survives admission freeze, invocation restart, and duplicate wake delivery", async () => {
    const messages: RuntimeWakeMessage[] = [];
    const memory = inMemoryRuntimeStore();
    const store = Object.freeze({ ...memory, id: "durable-fake" as const });
    const bound = vi.fn();
    const defer = vi.fn();
    const hostBoundRuntime = {
      kind: "host-bound",
      id: "request-service",
      host: "request-service",
      capabilities: {},
      entry: "requestService.run()",
    } as HostBoundRuntimeEngineDefinition;
    const execute = vi.fn(async (input: unknown) => {
      await Promise.resolve();
      createRuntimeWithHostContext({
        runtime: hostBoundRuntime,
        startMaintenance: false,
      });
      return { output: input };
    });
    const createHost = () =>
      createServerlessEvalHost({
        deploymentId: "production-eu",
        token: TOKEN,
        registry: fixtureRegistry(execute),
        hostCapabilities: HOST_CAPABILITIES,
        runtime: serverless({
          store,
          publicUrl: "https://runtime.example",
          namespace: "production-eu",
          wake: genericQueue({
            secret: WAKE_SECRET,
            enqueue: async (message) => {
              messages.push(message);
            },
          }),
        }),
        now: () => NOW,
      });
    const firstInvocation = createHost();
    const body = jobBody(fixtureRegistry());

    const accepted = await firstInvocation.fetch(
      authorizedRequest("/jobs", post(body)),
    );
    expect(accepted.status).toBe(202);
    expect(execute).not.toHaveBeenCalled();
    expect(messages).toHaveLength(1);
    firstInvocation.dispose();

    const restartedInvocation = createHost();
    const message = messages[0]!;
    const request = () =>
      new Request(message.url, {
        method: "POST",
        headers: message.headers,
        body: message.body,
      });
    const deliver = () =>
      runWithRuntimeHost(
        {
          host: "request-service",
          bind: () => {
            bound();
            return {} as never;
          },
          defer,
        },
        () => restartedInvocation.wake(request()),
      );

    await expect(deliver()).resolves.toMatchObject({ status: 200 });
    await expect(deliver()).resolves.toMatchObject({ status: 200 });
    await expect(
      pollUntilTerminal(restartedInvocation, body.jobId),
    ).resolves.toMatchObject({
      status: "succeeded",
      resultRef: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(bound).toHaveBeenCalledTimes(1);
    expect(defer).not.toHaveBeenCalled();
  });

  it("retries durable wake enqueue for an identical pending admission", async () => {
    const messages: RuntimeWakeMessage[] = [];
    let failDelivery = true;
    const memory = inMemoryRuntimeStore();
    const store = Object.freeze({ ...memory, id: "durable-fake" as const });
    const registry = fixtureRegistry();
    const runtime = serverless({
      store,
      publicUrl: "https://runtime.example",
      namespace: "production-eu",
      wake: genericQueue({
        secret: WAKE_SECRET,
        enqueue: async (message) => {
          if (failDelivery) throw new Error("queue unavailable");
          messages.push(message);
        },
      }),
    });
    const host = createServerlessEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      hostCapabilities: HOST_CAPABILITIES,
      runtime,
      now: () => NOW,
    });
    const body = jobBody(registry);

    await expect(
      host.fetch(authorizedRequest("/jobs", post(body))),
    ).rejects.toThrow("queue unavailable");
    failDelivery = false;
    await expect(
      host.fetch(authorizedRequest("/jobs", post(body))),
    ).resolves.toMatchObject({ status: 200 });
    expect(messages).toHaveLength(1);

    const message = messages[0]!;
    await host.wake(
      new Request(message.url, {
        method: "POST",
        headers: message.headers,
        body: message.body,
      }),
    );
    await expect(pollUntilTerminal(host, body.jobId)).resolves.toMatchObject({
      status: "succeeded",
    });
  });
});
