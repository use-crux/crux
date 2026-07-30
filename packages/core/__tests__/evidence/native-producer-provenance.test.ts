import { afterEach, describe, expect, it } from "vitest";
import {
  createCruxArtifactId,
  createInMemoryObservabilityTransport,
  flow,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src";
import type { CruxGraphRecord } from "../../src";
import {
  emitNativeEvidenceArtifact,
  recordNativeEvidence,
} from "../../src/evidence/internal";
import { resetHooks } from "../../src/runtime/runtime";

describe("native evidence producer provenance", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    resetHooks();
  });

  it("requires an explicit subject and binds the artifact producer", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const subject = explicitArtifactSubject();

    const result = await flow("native-explicit-subject", async (scope) =>
      scope.step("check", async () => {
        const producer = observe.captureContext()?.currentSpanId;
        const artifact = requiredCapability(
          emitNativeEvidenceArtifact(nativeArtifact()),
        );
        const ref = recordNativeEvidence({
          artifact,
          subject,
          role: "verification",
          conclusion: "passed",
        });
        expect(() =>
          recordNativeEvidence({
            artifact,
            subject: undefined as never,
            role: "verification",
            conclusion: "passed",
          }),
        ).toThrow();
        return { producer, ref };
      }),
    ).run();
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.ref.subject).toEqual(subject);
    expect(transport.records.filter(isNativeEvidenceRelationship)).toEqual([
      expect.objectContaining({
        to: { kind: "artifact", id: subject.id },
        attributes: expect.objectContaining({
          producer: { kind: "span", id: result.output.producer },
        }),
      }),
    ]);
  });

  it("preserves the originating producer in a later ambient context", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let artifact: ReturnType<typeof emitNativeEvidenceArtifact>;
    let originatingProducer: string | undefined;
    let laterSpan: string | undefined;
    const subject = explicitArtifactSubject();

    const result = await flow("native-late-binding", async (scope) => {
      await scope.step("prepare", async () => {
        originatingProducer = observe.captureContext()?.currentSpanId;
        artifact = requiredCapability(
          emitNativeEvidenceArtifact(nativeArtifact()),
        );
      });
      return scope.step("bind-later", async () => {
        laterSpan = observe.captureContext()?.currentSpanId;
        return recordNativeEvidence({
          artifact: requiredCapability(artifact),
          subject,
          role: "verification",
          conclusion: "passed",
        });
      });
    }).run();
    await observe.flush();

    expect(result.status).toBe("completed");
    expect(originatingProducer).toEqual(expect.any(String));
    expect(laterSpan).toEqual(expect.any(String));
    expect(laterSpan).not.toBe(originatingProducer);
    expect(transport.records.filter(isNativeEvidenceRelationship)).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({
          producer: { kind: "span", id: originatingProducer },
        }),
      }),
    ]);
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

function explicitArtifactSubject() {
  return { kind: "artifact", id: createCruxArtifactId() } as const;
}

function requiredCapability<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected native artifact");
  return value;
}

function isNativeEvidenceRelationship(record: CruxGraphRecord): boolean {
  return record.type === "edge" && record.edgeType === "evidence.for";
}
