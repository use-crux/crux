import { afterEach, describe, expect, it } from "vitest";
import {
  configureObservability,
  createInMemoryObservabilityTransport,
  evidence,
  flow,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
  subscribeObservability,
} from "../../src";
import { resetHooks } from "../../src/runtime/runtime";

const RAW_KEY = "PRIVATE-IDEMPOTENCY-KEY";
const RAW_PAYLOAD = "PRIVATE-PAYLOAD-VALUE";
const RAW_PATH = "/private/workspace/customer-secrets.json";
const SENTINELS = [RAW_KEY, RAW_PAYLOAD, RAW_PATH] as const;

describe("evidence privacy surfaces", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    resetHooks();
  });

  it("keeps raw keys, payloads, and paths out of every observable surface", async () => {
    const transport = createInMemoryObservabilityTransport();
    const subscriberRecords: unknown[] = [];
    setObservabilityTransport(transport);
    configureObservability({
      redactPaths: ["secret.payload", "workspace.path"],
    });
    const unsubscribe = subscribeObservability((record) => {
      subscriberRecords.push(record);
    });

    const result = await (async () => {
      try {
        return await flow("privacy-sentinel-evidence", async (scope) =>
          scope.step("record", async () => {
            const common = {
              role: "verification",
              conclusion: "passed",
              kind: "custom.privacy-sentinel",
              idempotencyKey: RAW_KEY,
            } as const;
            const ref = evidence.record({
              ...common,
              data: {
                secret: { payload: RAW_PAYLOAD },
                workspace: { path: RAW_PATH },
                verdict: "first",
              },
            });
            let conflict: unknown;
            try {
              evidence.record({
                ...common,
                data: {
                  secret: { payload: RAW_PAYLOAD },
                  workspace: { path: RAW_PATH },
                  verdict: "second",
                },
              });
            } catch (error) {
              conflict = error;
            }
            return {
              ref,
              conflict,
              view: await evidence.inspect(ref.subject, {
                includeData: true,
              }),
            };
          }),
        ).run();
      } finally {
        unsubscribe();
      }
    })();
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.view.roles.verification.records[0]?.data).toEqual({
      secret: "[redacted]",
      workspace: { path: "[redacted]" },
      verdict: "first",
    });
    expect(result.output.conflict).toMatchObject({
      code: "EVIDENCE_IDEMPOTENCY_CONFLICT",
    });

    const serializedSurfaces = JSON.stringify({
      returnedRef: result.output.ref,
      collectorView: result.output.view,
      graphRecords: transport.records,
      subscriberRecords,
      diagnostics: observabilityDiagnostics(),
      error: {
        value: result.output.conflict,
        text: String(result.output.conflict),
        stack:
          result.output.conflict instanceof Error
            ? result.output.conflict.stack
            : undefined,
      },
    });
    for (const sentinel of SENTINELS) {
      expect(serializedSurfaces).not.toContain(sentinel);
    }
  });
});
