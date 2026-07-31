import { afterEach, describe, expect, it, vi } from "vitest";
import * as core from "../../src";
import {
  configureObservability,
  createInMemoryObservabilityTransport,
  flow,
  resetObservabilityRuntime,
  setObservabilityTransport,
  subscribeObservability,
} from "../../src";
import type { CruxGraphRecord } from "../../src";
import {
  emitNativeEvidenceArtifact,
  nativeEvidenceArtifactRef,
  recordNativeEvidence,
} from "../../src/evidence/internal";
import { resetHooks, updateHooks } from "../../src/runtime/runtime";

describe("native evidence artifact capability", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    resetHooks();
  });

  it("is package-private, opaque, and resistant to structural lookalikes", async () => {
    expect(core).not.toHaveProperty("emitNativeEvidenceArtifact");
    expect(core).not.toHaveProperty("recordNativeEvidence");

    const result = await flow("native-capability-brand", async (scope) =>
      scope.step("bind", async () => {
        const artifact = requiredCapability(
          emitNativeEvidenceArtifact(nativeArtifact()),
        );
        const subject = {
          kind: "artifact",
          id: core.createCruxArtifactId(),
        } as const;
        const bind = (candidate: unknown) =>
          recordNativeEvidence({
            artifact: candidate as never,
            subject,
            role: "verification",
            conclusion: "passed",
          });
        expect(Object.isFrozen(artifact)).toBe(true);
        expect(JSON.stringify(artifact)).toBe("{}");
        for (const lookalike of [
          {},
          { ...artifact },
          JSON.parse(JSON.stringify(artifact)),
          Object.create(Object.getPrototypeOf(artifact)),
        ]) {
          expect(() => bind(lookalike)).toThrowError(
            "Native evidence requires an artifact capability created by Core.",
          );
        }
      }),
    ).run();

    expect(result.status).toBe("completed");
  });

  it("prepares configured redaction, privacy, and sanitization once", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    configureObservability({ redactPaths: ["credentials.token"] });
    const artifactPrivacyCalls: CruxGraphRecord[] = [];
    const redactRecord = vi.fn((record: CruxGraphRecord) => {
      if (record.type === "artifact" && record.kind === "constraint.report") {
        artifactPrivacyCalls.push(record);
      }
      return record;
    });
    updateHooks({ observabilityCapture: { redactRecord } });

    await flow("native-one-pass", async (scope) =>
      scope.step("emit", async () => {
        requiredCapability(
          emitNativeEvidenceArtifact({
            ...nativeArtifact(),
            preview: {
              credentials: { token: "PRIVATE", label: "safe" },
              unsupported: 7n,
            },
          }),
        );
      }),
    ).run();
    await core.observe.flush();

    expect(artifactPrivacyCalls).toHaveLength(1);
    expect(artifactPrivacyCalls[0]).toMatchObject({
      preview: {
        credentials: { token: "[redacted]", label: "safe" },
        unsupported: "7",
      },
    });
    expect(
      transport.records.find(
        (record) =>
          record.type === "artifact" && record.kind === "constraint.report",
      ),
    ).toMatchObject({
      preview: {
        credentials: { token: "[redacted]", label: "safe" },
        unsupported: "7",
      },
    });
  });

  it("binds the final validated identity after last-mile privacy", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const finalArtifactId = core.createCruxArtifactId();
    updateHooks({
      observabilityCapture: {
        redactRecord(record) {
          return record.type === "artifact"
            ? {
                ...record,
                artifactId: finalArtifactId,
                kind: "validation.feedback",
              }
            : record;
        },
      },
    });

    const result = await flow("native-final-identity", async (scope) =>
      scope.step("emit", async () =>
        nativeEvidenceArtifactRef(
          requiredCapability(emitNativeEvidenceArtifact(nativeArtifact())),
        ),
      ),
    ).run();
    await core.observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output).toEqual({
      id: finalArtifactId,
      kind: "validation.feedback",
    });
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        artifactId: finalArtifactId,
        kind: "validation.feedback",
      }),
    );
  });

  it("fails closed for suppression and invalid artifacts", async () => {
    const records: CruxGraphRecord[] = [];
    const unsubscribe = subscribeObservability((record) =>
      records.push(record),
    );
    updateHooks({
      observabilityCapture: {
        redactRecord(record) {
          return record.type === "artifact" ? null : record;
        },
      },
    });

    await flow("native-suppression", async (scope) =>
      scope.step("emit", async () => {
        expect(emitNativeEvidenceArtifact(nativeArtifact())).toBeUndefined();
      }),
    ).run();
    resetHooks();
    await flow("native-invalid", async (scope) =>
      scope.step("emit", async () => {
        expect(
          emitNativeEvidenceArtifact({
            ...nativeArtifact(),
            kind: "invalid-kind" as never,
          }),
        ).toBeUndefined();
      }),
    ).run();
    unsubscribe();

    expect(records.some((record) => record.type === "artifact")).toBe(false);
    expect(
      records.some(
        (record) =>
          record.type === "edge" && record.edgeType === "evidence.for",
      ),
    ).toBe(false);
  });

  it("retains a capability after reference or not-captured reduction", async () => {
    for (const capture of ["evidence", "off"] as const) {
      resetHooks();
      updateHooks({ observabilityCapture: { capture } });
      const result = await flow(`native-${capture}`, async (scope) =>
        scope.step("emit", async () =>
          nativeEvidenceArtifactRef(
            requiredCapability(emitNativeEvidenceArtifact(nativeArtifact())),
          ),
        ),
      ).run();
      expect(result.status).toBe("completed");
      if (result.status === "completed") {
        expect(result.output.kind).toBe("constraint.report");
      }
    }
  });
});

function nativeArtifact() {
  return {
    kind: "constraint.report",
    contentType: "application/json",
    encoding: "json",
    preview: { passed: true },
  } as const;
}

function requiredCapability<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected native artifact");
  return value;
}
