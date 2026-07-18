import { describe, expect, it } from "vitest";
import {
  createServerlessEvalHost,
  EvalHostSetupError,
} from "../../../../src/runtime/eval-host";
import {
  genericQueue,
  inMemoryRuntimeStore,
  serverless,
} from "@use-crux/core/runtime";
import { fixtureRegistry, TOKEN } from "../fixture";

describe("serverless Eval host preflight", () => {
  it.each([
    ["store_missing", { store: undefined }],
    ["wake_missing", { createWake: undefined }],
    ["result_store_missing", { results: undefined }],
    ["entry_missing", { registry: undefined }],
    ["token_missing", { token: "" }],
  ] as const)("reports %s before binding a handler", (code, replacement) => {
    const memory = inMemoryRuntimeStore();
    const store = Object.freeze({ ...memory, id: "durable-fake" as const });
    const runtime = serverless({
      store,
      publicUrl: "https://runtime.example",
      namespace: "production-eu",
      wake: genericQueue({
        secret: "runtime-wake-capability-32-bytes",
        enqueue: async () => undefined,
      }),
    });
    const options = {
      deploymentId: "production-eu",
      token: TOKEN,
      registry: fixtureRegistry(),
      runtime,
    };
    const malformed =
      code === "store_missing" || code === "wake_missing"
        ? {
            ...options,
            runtime: { ...runtime, ...replacement },
          }
        : code === "result_store_missing"
          ? {
              ...options,
              runtime: {
                ...runtime,
                store: { ...store, ...replacement },
              },
            }
          : { ...options, ...replacement };

    expect(() => createServerlessEvalHost(malformed as never)).toThrow(
      EvalHostSetupError,
    );
    expect(() => createServerlessEvalHost(malformed as never)).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it("rejects the process-local memory store", () => {
    const runtime = serverless({
      store: inMemoryRuntimeStore(),
      publicUrl: "https://runtime.example",
      namespace: "production-eu",
      wake: genericQueue({
        secret: "runtime-wake-capability-32-bytes",
        enqueue: async () => undefined,
      }),
    });

    expect(() =>
      createServerlessEvalHost({
        deploymentId: "production-eu",
        token: TOKEN,
        registry: fixtureRegistry(),
        runtime,
      }),
    ).toThrow(expect.objectContaining({ code: "durable_store_required" }));
  });
});
