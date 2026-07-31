import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHttpObservabilityTransport,
  evidence,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type EvidenceDestinationInspectResult,
  type EvidenceSubject,
} from "../../src";

const subject = {
  kind: "execution",
  id: "2222222222222222",
} as EvidenceSubject;

describe("Local HTTP evidence destination", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("uses the Local inspect endpoint without leaking the ingest credential", async () => {
    const result = emptyResult(subject);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const transport = createHttpObservabilityTransport({
      serverUrl: "http://localhost:4400/crux",
      token: "ingest-only",
      fetch: fetchImpl,
    });
    const request = {
      subject,
      role: "verification",
      limit: 7,
      cursor: "opaque",
      includeHistory: true,
      includeData: true,
    } as const;

    await expect(
      transport.evidence?.inspectEvidence(request),
    ).resolves.toEqual(result);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4400/crux/api/observability/evidence/inspect",
      expect.objectContaining({
        method: "POST",
        headers: expect.not.objectContaining({
          Authorization: expect.anything(),
        }),
        body: JSON.stringify(request),
      }),
    );
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("ingest-only");
  });

  it.each([
    ["authorization failure", new Response("denied", { status: 401 })],
    ["invalid response", new Response("not-json", { status: 200 })],
  ])("fails closed on %s", async (_name, response) => {
    const transport = createHttpObservabilityTransport({
      fetch: vi.fn(async () => response),
    });

    await expect(
      transport.evidence?.inspectEvidence({
        subject,
        limit: 50,
        includeHistory: false,
        includeData: false,
      }),
    ).rejects.toThrow("Evidence inspection request failed");
  });

  it("rejects a structurally invalid Local read model before projection", async () => {
    const result = emptyResult(subject);
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ...result,
          roles: {
            ...result.roles,
            verification: {
              ...result.roles.verification,
              role: "change",
            },
          },
        }),
        { status: 200 },
      ),
    );
    setObservabilityTransport(
      createHttpObservabilityTransport({ fetch: fetchImpl }),
    );

    await expect(evidence.inspect(subject)).rejects.toMatchObject({
      code: "EVIDENCE_INPUT_INVALID",
    });
  });

  it("normalizes a Local record with an explicit empty supersession list", async () => {
    const result = emptyResult(subject);
    result.roles.verification.records.push({
      ref: {
        kind: "execution.evidence",
        id: "evidence_1111111111111111",
        subject,
        role: "verification",
        evidenceKind: "score.report",
        recordedAt: "2026-07-29T12:00:00Z",
      },
      source: {
        kind: "artifact",
        id: "artifact_1111111111111111",
      },
      conclusion: "passed",
      supersedes: [],
      producer: {
        kind: "execution",
        id: "2222222222222222",
      },
      payloadState: "reference",
    });
    result.roles.verification.status = "present";
    result.roles.verification.activeRecordCount = 1;
    result.roles.verification.conclusion = "passed";
    setObservabilityTransport(
      createHttpObservabilityTransport({
        fetch: vi.fn(async () =>
          new Response(JSON.stringify(result), { status: 200 }),
        ),
      }),
    );

    await expect(evidence.inspect(subject)).resolves.toMatchObject({
      roles: {
        verification: {
          status: "present",
          records: [{ supersedes: [] }],
        },
      },
    });
  });
});

function emptyResult(
  requestedSubject: EvidenceSubject,
): {
  subject: EvidenceSubject;
  roles: {
    [R in keyof EvidenceDestinationInspectResult["roles"]]: {
      -readonly [K in keyof EvidenceDestinationInspectResult["roles"][R]]:
        EvidenceDestinationInspectResult["roles"][R][K] extends readonly (
          infer T
        )[]
          ? T[]
          : EvidenceDestinationInspectResult["roles"][R][K];
    };
  };
} {
  const role = <R extends keyof EvidenceDestinationInspectResult["roles"]>(
    value: R,
  ) => ({
    role: value,
    status: "not-yet-recorded" as const,
    activeRecordCount: 0,
    records: [],
    conflicting: false,
    truncated: false,
  });
  return {
    subject: requestedSubject,
    roles: {
      intent: role("intent"),
      authority: role("authority"),
      change: role("change"),
      verification: role("verification"),
      recovery: role("recovery"),
    },
  };
}
