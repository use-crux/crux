import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryObservabilityTransport,
  evidence,
  flow,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src";
import type { CruxGraphRecord } from "../../src";
import { resetHooks, updateHooks } from "../../src/runtime/runtime";

describe("evidence graph privacy policy", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    resetHooks();
  });

  it("retains redacted metadata and suppresses the batch when privacy drops the artifact", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const artifactCalls: string[] = [];
    updateHooks({
      observabilityCapture: {
        redactRecord(record) {
          if (
            record.type === "artifact" &&
            record.kind === "custom.private-review"
          ) {
            artifactCalls.push(record.recordId);
            return null;
          }
          return record;
        },
      },
    });

    const result = await recordAndInspect("custom.private-review", {
      secret: "must-be-dropped",
    });
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(artifactCalls).toHaveLength(1);
    expect(result.output.view.roles.verification.records[0]).toMatchObject({
      ref: result.output.ref,
      payloadState: "redacted",
    });
    expect(
      result.output.view.roles.verification.records[0],
    ).not.toHaveProperty("data");
    expect(hasEvidenceBatch(transport.records, "custom.private-review")).toBe(
      false,
    );
    expect(JSON.stringify(transport.records)).not.toContain("must-be-dropped");
    expect(observabilityDiagnostics().redactedRecords).toBeGreaterThan(0);
  });

  it("fails closed when the privacy hook rewrites protected evidence identity", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    updateHooks({
      observabilityCapture: {
        redactRecord(record) {
          return record.type === "artifact" &&
            record.kind === "custom.identity-review"
            ? { ...record, kind: "custom.rewritten-kind" }
            : record;
        },
      },
    });

    const result = await recordAndInspect("custom.identity-review", {
      approved: true,
    });
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.view.roles.verification.records[0]).toMatchObject({
      payloadState: "redacted",
    });
    expect(hasEvidenceBatch(transport.records, "custom.identity-review")).toBe(
      false,
    );
    expect(
      transport.records.some(
        (record) =>
          record.type === "artifact" &&
          record.kind === "custom.rewritten-kind",
      ),
    ).toBe(false);
    expect(observabilityDiagnostics().redactedRecords).toBeGreaterThan(0);
  });

  it.each([
    {
      name: "inline source marker",
      rewrite(record: CruxGraphRecord): CruxGraphRecord {
        return record.type === "artifact" &&
          record.kind === "custom.protected-review"
          ? {
              ...record,
              attributes: {
                evidenceSource: {
                  evidenceId: "evidence_ffffffffffffffff",
                  captureState: "available",
                },
              },
            }
          : record;
      },
    },
    {
      name: "inline source capture state",
      rewrite(record: CruxGraphRecord): CruxGraphRecord {
        if (
          record.type !== "artifact" ||
          record.kind !== "custom.protected-review"
        ) {
          return record;
        }
        const source = Reflect.get(
          record.attributes ?? {},
          "evidenceSource",
        );
        const evidenceId =
          typeof source === "object" && source !== null
            ? Reflect.get(source, "evidenceId")
            : undefined;
        return {
          ...record,
          attributes: {
            evidenceSource: {
              evidenceId,
              captureState: "reference",
            },
          },
        };
      },
    },
    {
      name: "producer",
      rewrite(record: CruxGraphRecord): CruxGraphRecord {
        return record.type === "edge" &&
          record.edgeType === "evidence.for"
          ? {
              ...record,
              attributes: {
                ...record.attributes,
                producer: { kind: "run", id: "run_rewritten" },
              },
            }
          : record;
      },
    },
  ])("fails closed when privacy rewrites the protected $name", async ({ rewrite }) => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    updateHooks({
      observabilityCapture: { redactRecord: rewrite },
    });

    const result = await flow("protected-evidence-identity", async (scope) =>
      scope.step("record", async () => {
        const ref = evidence.record({
          role: "verification",
          conclusion: "passed",
          kind: "custom.protected-review",
          data: { approved: true },
          idempotencyKey: "protected-retry",
        });
        return {
          ref,
          view: await evidence.inspect(ref.subject, { includeData: true }),
        };
      }),
    ).run();
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.view.roles.verification.records[0]).toMatchObject({
      payloadState: "redacted",
    });
    expect(
      hasEvidenceBatch(transport.records, "custom.protected-review"),
    ).toBe(false);
  });

  it("suppresses the prepared artifact when privacy rejects the evidence edge", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    updateHooks({
      observabilityCapture: {
        redactRecord(record) {
          return record.type === "edge" &&
            record.edgeType === "evidence.for"
            ? null
            : record;
        },
      },
    });

    const result = await recordAndInspect("custom.edge-private-review", {
      approved: true,
    });
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.view.roles.verification.records[0]).toMatchObject({
      payloadState: "redacted",
    });
    expect(
      hasEvidenceBatch(transport.records, "custom.edge-private-review"),
    ).toBe(false);
    expect(observabilityDiagnostics().redactedRecords).toBeGreaterThan(0);
  });

  it("fails closed when the privacy hook throws for the artifact", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    updateHooks({
      observabilityCapture: {
        redactRecord(record) {
          if (
            record.type === "artifact" &&
            record.kind === "custom.throwing-review"
          ) {
            throw new Error("privacy hook failed");
          }
          return record;
        },
      },
    });

    const result = await recordAndInspect("custom.throwing-review", {
      secret: "must-not-leak",
    });
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.view.roles.verification.records[0]).toMatchObject({
      payloadState: "redacted",
    });
    expect(hasEvidenceBatch(transport.records, "custom.throwing-review")).toBe(
      false,
    );
    expect(JSON.stringify(transport.records)).not.toContain("must-not-leak");
    expect(observabilityDiagnostics().redactedRecords).toBeGreaterThan(0);
  });
});

function recordAndInspect(kind: `custom.${string}`, data: object) {
  return flow("privacy-policy-evidence", async (scope) =>
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

function hasEvidenceBatch(
  records: ReturnType<typeof createInMemoryObservabilityTransport>["records"],
  kind: `custom.${string}`,
): boolean {
  return records.some(
    (record) =>
      (record.type === "artifact" && record.kind === kind) ||
      (record.type === "edge" && record.edgeType === "evidence.for"),
  );
}
