import { afterEach, describe, expect, it } from "vitest";
import {
  CruxEvidenceError,
  createCruxArtifactId,
  createInMemoryObservabilityTransport,
  evidence,
  flow,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src";

describe("evidence idempotency", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("creates unrelated identities when no idempotency key is provided", () => {
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const input = {
      subject,
      role: "verification",
      conclusion: "passed",
      kind: "custom.retry-review",
      data: { approved: true },
    } as const;

    expect(evidence.record(input).id).not.toBe(evidence.record(input).id);
  });

  it("derives the same relationship ID when no local occurrence is visible", () => {
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const source = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const input = {
      subject,
      role: "verification",
      conclusion: "passed",
      ref: source,
      kind: "score.report",
      idempotencyKey: "stable-retry-key",
    } as const;

    const first = evidence.record(input);
    const second = evidence.record(input);

    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^evidence_[0-9a-f]{64}$/u);
    expect(first).not.toBe(second);
  });

  it("uses one protected inline artifact identity across independent retries", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const input = {
      subject,
      role: "verification",
      conclusion: "passed",
      kind: "custom.retry-review",
      data: { approved: true },
      idempotencyKey: "independent-retry-key",
    } as const;

    const first = evidence.record(input);
    const second = evidence.record(input);
    await observe.flush();

    expect(second.id).toBe(first.id);
    const artifacts = transport.records.filter(
      (record) =>
        record.type === "artifact" &&
        record.kind === "custom.retry-review",
    );
    expect(artifacts).toHaveLength(2);
    expect(new Set(artifacts.map(({ artifactId }) => artifactId)).size).toBe(1);
    expect(artifacts[0]).toMatchObject({
      attributes: {
        evidenceSource: {
          evidenceId: first.id,
          captureState: "available",
        },
      },
    });
    const edges = transport.records.filter(
      (record) =>
        record.type === "edge" && record.edgeType === "evidence.for",
    );
    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({
      from: { kind: "artifact", id: artifacts[0]?.artifactId },
      attributes: {
        sourceMode: "inline",
        contentDigestVersion: 1,
        contentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
    });
    expect(edges[1]).toMatchObject({
      from: edges[0]?.from,
      attributes: {
        contentDigest: edges[0]?.attributes?.contentDigest,
      },
    });
  });

  it("returns the original local ref and emits a matching retry only once", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await flow("idempotent-evidence", async (scope) =>
      scope.step("record", async () => {
        const input = {
          role: "verification",
          conclusion: "passed",
          kind: "custom.retry-review",
          data: { nested: { approved: true } },
          idempotencyKey: "private-retry-key",
        } as const;
        const first = evidence.record(input);
        const second = evidence.record(input);
        return {
          first,
          second,
          view: await evidence.inspect(first.subject, {
            includeData: true,
          }),
        };
      }),
    ).run();
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.second).toBe(result.output.first);
    expect(result.output.view.roles.verification.records).toHaveLength(1);
    expect(
      transport.records.filter(
        (record) =>
          record.type === "artifact" &&
          record.kind === "custom.retry-review",
      ),
    ).toHaveLength(1);
    const edges = transport.records.filter(
      (record) =>
        record.type === "edge" && record.edgeType === "evidence.for",
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      attributes: {
        idempotencyKeyHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        sourceMode: "inline",
        contentDigestVersion: 1,
        contentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
    });
    expect(
      JSON.stringify({
        refs: [result.output.first, result.output.second],
        view: result.output.view,
        records: transport.records,
      }),
    ).not.toContain("private-retry-key");
  });

  it("rejects divergent content without replacing the accepted occurrence", async () => {
    const result = await flow("conflicting-evidence", async (scope) =>
      scope.step("record", async () => {
        const shared = {
          role: "verification",
          conclusion: "passed",
          kind: "custom.retry-review",
          idempotencyKey: "conflicting-private-key",
        } as const;
        const first = evidence.record({
          ...shared,
          data: { approved: true },
        });
        let conflict: unknown;
        try {
          evidence.record({
            ...shared,
            data: { approved: false },
          });
        } catch (error) {
          conflict = error;
        }
        return {
          first,
          conflict,
          view: await evidence.inspect(first.subject, {
            includeData: true,
          }),
        };
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.conflict).toMatchObject({
      name: "CruxEvidenceError",
      code: "EVIDENCE_IDEMPOTENCY_CONFLICT",
    });
    expect(CruxEvidenceError.isInstance(result.output.conflict)).toBe(true);
    expect(String(result.output.conflict)).not.toContain(
      "conflicting-private-key",
    );
    expect(result.output.view.roles.verification.records).toHaveLength(1);
    expect(
      result.output.view.roles.verification.records[0]?.data,
    ).toEqual({ approved: true });
  });

  it("separates subject, role, and evidence kind identity domains", () => {
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const otherSubject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const common = {
      idempotencyKey: "same-key",
      data: {},
    } as const;

    const base = evidence.record({
      ...common,
      subject,
      role: "verification",
      kind: "custom.first",
    });
    const changedSubject = evidence.record({
      ...common,
      subject: otherSubject,
      role: "verification",
      kind: "custom.first",
    });
    const changedRole = evidence.record({
      ...common,
      subject,
      role: "change",
      kind: "custom.first",
    });
    const changedKind = evidence.record({
      ...common,
      subject,
      role: "verification",
      kind: "custom.second",
    });

    expect(
      new Set([
        base.id,
        changedSubject.id,
        changedRole.id,
        changedKind.id,
      ]).size,
    ).toBe(4);
  });

  it("rejects a deterministic relationship that supersedes itself", () => {
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const source = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const common = {
      subject,
      role: "verification",
      ref: source,
      kind: "score.report",
      idempotencyKey: "self-cycle-key",
    } as const;
    const first = evidence.record(common);

    expect(() =>
      evidence.record({
        ...common,
        supersedes: first,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_SUPERSESSION_INVALID",
      }),
    );
  });
});
