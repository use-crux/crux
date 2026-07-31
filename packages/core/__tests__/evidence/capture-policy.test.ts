import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureObservability,
  createInMemoryObservabilityTransport,
  evidence,
  flow,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  subscribeObservability,
} from "../../src";
import { registerEvalObservabilityCaptureHooks } from "../../src/observability/eval-capture-hooks";
import { resetHooks, updateHooks } from "../../src/runtime/runtime";

describe("evidence capture policy", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    resetHooks();
  });

  it("retains only a reference when evidence capture removes the preview", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    updateHooks({
      observabilityCapture: { capture: "evidence" },
    });

    const result = await recordAndInspect("custom.editorial-review", {
      secret: "must-not-remain-local",
    });
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const record = result.output.view.roles.verification.records[0];
    expect(record).toMatchObject({
      ref: result.output.ref,
      payloadState: "reference",
    });
    expect(record).not.toHaveProperty("data");
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "custom.editorial-review",
        encoding: "reference",
        sizeBytes: 34,
        hash:
          "sha256:5caf2bc204d17f704e115592b9422f948bf173e279145e8bdc834682b4ac01c0",
        attributes: {
          evidenceSource: {
            evidenceId: result.output.ref.id,
            captureState: "reference",
          },
        },
      }),
    );
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        attributes: expect.objectContaining({ captureState: "reference" }),
      }),
    );
  });

  it("records not-captured when capture is off for a custom artifact", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    updateHooks({
      observabilityCapture: { capture: "off" },
    });

    const result = await recordAndInspect("custom.private-review", {
      secret: "must-not-be-captured",
    });
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const record = result.output.view.roles.verification.records[0];
    expect(record?.payloadState).toBe("not-captured");
    expect(record).not.toHaveProperty("data");
    const artifact = transport.records.find(
      (candidate) =>
        candidate.type === "artifact" &&
        candidate.kind === "custom.private-review",
    );
    expect(artifact).toMatchObject({
      encoding: "reference",
      attributes: {
        evidenceSource: {
          evidenceId: result.output.ref.id,
          captureState: "not-captured",
        },
      },
    });
    expect(artifact).not.toHaveProperty("sizeBytes");
    expect(JSON.stringify(transport.records)).not.toContain(
      "must-not-be-captured",
    );
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        attributes: expect.objectContaining({
          captureState: "not-captured",
        }),
      }),
    );
  });

  it("applies configured redact paths before the one-pass privacy hook", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    configureObservability({
      redactPaths: ["credentials.token"],
    });
    const artifactPreviews: unknown[] = [];
    const evalRecords: unknown[] = [];
    const subscriberRecords: unknown[] = [];
    const restoreEvalHooks = registerEvalObservabilityCaptureHooks({
      currentCaptureSession: () => ({
        send(records) {
          evalRecords.push(...records);
        },
      }),
      shouldQuarantineWrite: () => false,
    });
    const unsubscribe = subscribeObservability((record) => {
      subscriberRecords.push(record);
    });
    const redactRecord = vi.fn((record) => {
      if (
        record.type === "artifact" &&
        record.kind === "custom.redacted-review"
      ) {
        artifactPreviews.push(record.preview);
      }
      return record;
    });
    updateHooks({
      observabilityCapture: { redactRecord },
    });

    const result = await (async () => {
      try {
        const recorded = await recordAndInspect("custom.redacted-review", {
          credentials: {
            token: "RAW-TOKEN",
            label: "safe",
          },
        });
        await observe.flush();
        return recorded;
      } finally {
        unsubscribe();
        restoreEvalHooks();
      }
    })();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const safeData = {
      credentials: {
        token: "[redacted]",
        label: "safe",
      },
    };
    expect(artifactPreviews).toEqual([safeData]);
    expect(result.output.view.roles.verification.records[0]).toMatchObject({
      payloadState: "available",
      data: safeData,
    });
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        preview: safeData,
      }),
    );
    expect(evalRecords).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        preview: safeData,
      }),
    );
    expect(subscriberRecords).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        preview: safeData,
      }),
    );
    expect(JSON.stringify(evalRecords)).not.toContain("RAW-TOKEN");
    expect(JSON.stringify(subscriberRecords)).not.toContain("RAW-TOKEN");
    expect(JSON.stringify(transport.records)).not.toContain("RAW-TOKEN");
  });

});

function recordAndInspect(kind: `custom.${string}`, data: object) {
  return flow("capture-policy-evidence", async (scope) =>
    scope.step("record", async () => {
      const ref = evidence.record({
        role: "verification",
        conclusion: "passed",
        kind,
        data,
      });
      return {
        ref,
        view: await evidence.inspect(ref.subject, { includeData: true }),
      };
    }),
  ).run();
}
