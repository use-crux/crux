import { afterEach, describe, expect, it } from "vitest";
import {
  createCruxArtifactId,
  createInMemoryObservabilityTransport,
  flow,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src";
import type { CruxArtifactId, CruxGraphRecord } from "../../src";
import {
  emitNativeEvidenceArtifact,
  recordNativeEvidence,
} from "../../src/evidence/internal";
import { resetHooks } from "../../src/runtime/runtime";

describe("native evidence producer", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    resetHooks();
  });

  it("binds one artifact capability and relationship tuple exactly once", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await flow("native-evidence", async (scope) =>
      scope.step("bind", async () => {
        const subject = explicitArtifactSubject();
        const artifact = requiredCapability(
          emitNativeEvidenceArtifact({
            kind: "constraint.report",
            contentType: "application/json",
            encoding: "json",
            preview: { passed: true },
          }),
        );
        const input = {
          artifact,
          subject,
          role: "verification",
          conclusion: "passed",
        } as const;
        return {
          first: recordNativeEvidence(input),
          second: recordNativeEvidence(input),
        };
      }),
    ).run();
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.second).toBe(result.output.first);
    expect(transport.records.filter(isNativeEvidenceRelationship)).toHaveLength(
      1,
    );
    expect(
      transport.records.findIndex((record) => record.type === "artifact"),
    ).toBeLessThan(transport.records.findIndex(isNativeEvidenceRelationship));
  });

  it("changes identity for every binding tuple field", async () => {
    const result = await flow("native-evidence-tuples", async (scope) =>
      scope.step("bind", async () => {
        const sharedArtifactId = createCruxArtifactId();
        const firstArtifact = requiredCapability(
          emitNativeEvidenceArtifact({
            ...nativeArtifact(),
            artifactId: sharedArtifactId,
          }),
        );
        const otherKindArtifact = requiredCapability(
          emitNativeEvidenceArtifact({
            ...nativeArtifact(),
            artifactId: sharedArtifactId,
            kind: "validation.feedback",
          }),
        );
        const otherArtifact = requiredCapability(
          emitNativeEvidenceArtifact(nativeArtifact()),
        );
        const firstSubject = explicitArtifactSubject();
        const secondSubject = explicitArtifactSubject();
        const base = recordNativeEvidence({
          artifact: firstArtifact,
          subject: firstSubject,
          role: "verification",
          conclusion: "passed",
        });
        return {
          base,
          artifact: recordNativeEvidence({
            artifact: otherArtifact,
            subject: firstSubject,
            role: "verification",
            conclusion: "passed",
          }),
          evidenceKind: recordNativeEvidence({
            artifact: otherKindArtifact,
            subject: firstSubject,
            role: "verification",
            conclusion: "passed",
          }),
          subject: recordNativeEvidence({
            artifact: firstArtifact,
            subject: secondSubject,
            role: "verification",
            conclusion: "passed",
          }),
          role: recordNativeEvidence({
            artifact: firstArtifact,
            subject: firstSubject,
            role: "change",
            conclusion: "applied",
          }),
        };
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(new Set(Object.values(result.output).map(({ id }) => id)).size).toBe(
      5,
    );
    expect(result.output.evidenceKind.evidenceKind).toBe("validation.feedback");
  });

  it("keeps identical content in random artifact occurrences as separate claims", async () => {
    const result = await flow("native-random-occurrences", async (scope) =>
      scope.step("bind", async () => {
        const subject = explicitArtifactSubject();
        const record = () =>
          recordNativeEvidence({
            artifact: requiredCapability(
              emitNativeEvidenceArtifact(nativeArtifact()),
            ),
            subject,
            role: "verification",
            conclusion: "passed",
          });
        return [record(), record()] as const;
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output[0].id).not.toBe(result.output[1].id);
  });

  it("deduplicates a domain-owned deterministic artifact occurrence", async () => {
    const stableArtifactId = "artifact_aaaaaaaaaaaaaaaa" as CruxArtifactId;
    const subject = explicitArtifactSubject();
    const run = () =>
      flow("native-stable-occurrence", async (scope) =>
        scope.step("bind", async () =>
          recordNativeEvidence({
            artifact: requiredCapability(
              emitNativeEvidenceArtifact({
                ...nativeArtifact(),
                artifactId: stableArtifactId,
              }),
            ),
            subject,
            role: "verification",
            conclusion: "passed",
          }),
        ),
      ).run();

    const first = await run();
    const second = await run();
    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");
    if (first.status !== "completed" || second.status !== "completed") return;
    expect(second.output.id).toBe(first.output.id);
  });

  it("rejects divergent relationship content for one binding tuple", async () => {
    const result = await flow("native-divergent-tuple", async (scope) =>
      scope.step("bind", async () => {
        const artifact = requiredCapability(
          emitNativeEvidenceArtifact(nativeArtifact()),
        );
        const subject = explicitArtifactSubject();
        recordNativeEvidence({
          artifact,
          subject,
          role: "verification",
          conclusion: "passed",
        });
        expect(() =>
          recordNativeEvidence({
            artifact,
            subject,
            role: "verification",
            conclusion: "failed",
          }),
        ).toThrow(
          expect.objectContaining({
            code: "EVIDENCE_IDEMPOTENCY_CONFLICT",
          }),
        );
      }),
    ).run();

    expect(result.status).toBe("completed");
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
