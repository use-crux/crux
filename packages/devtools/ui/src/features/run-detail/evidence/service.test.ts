import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvidenceRole } from "@use-crux/core/evidence";
import {
  fetchEvidenceInspection,
  fetchEvidenceNavigation,
  fetchEvidenceSubjectSummaries,
  mergeEvidencePages,
} from "./service";
import type {
  EvidenceApiInspectResult,
  EvidenceApiRoleResult,
} from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("evidence inspection service", () => {
  it("posts the exact bounded query without an ingest bearer", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(result("evidence_1", "cursor_next")),
    );
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:5173" },
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchEvidenceInspection({
      subject: { kind: "execution", id: "span_subject" },
      role: "verification",
      limit: 10,
      includeHistory: true,
      includeData: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5173/api/observability/evidence/inspect",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: { kind: "execution", id: "span_subject" },
          role: "verification",
          limit: 10,
          includeHistory: true,
          includeData: true,
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "Authorization",
    );
  });

  it("merges selected-role pages while retaining first-page complete aggregates", () => {
    const first = result("evidence_1", "cursor_next");
    const secondBase = result("evidence_2");
    const second: EvidenceApiInspectResult = {
      ...secondBase,
      roles: {
        ...secondBase.roles,
        verification: {
          ...secondBase.roles.verification,
          status: "redacted",
          conflicting: true,
        },
      },
    };

    const merged = mergeEvidencePages(
      [first, second],
      "verification",
    ) as EvidenceApiInspectResult;
    expect(
      merged.roles.verification.records.map((record) => record.ref.id),
    ).toEqual(["evidence_1", "evidence_2"]);
    expect(merged.roles.verification.status).toBe("present");
    expect(merged.roles.verification.conflicting).toBe(false);
    expect(merged.roles.verification.cursor).toBeUndefined();
  });
});

describe("evidence batch read services", () => {
  it("posts positional subject summaries without a presentation limit", async () => {
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:5173" },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [] })),
    );
    const subjects = [{ kind: "execution", id: "span_a" }] as const;

    await fetchEvidenceSubjectSummaries(subjects);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/observability/evidence/subjects/summary",
      ),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ subjects }),
      }),
    );
  });

  it("posts exact graph refs to the navigation resolver", async () => {
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:5173" },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [] })),
    );
    const refs = [{ kind: "span", id: "span_a" }] as const;

    await fetchEvidenceNavigation(refs);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/observability/evidence/navigation/resolve",
      ),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ refs }),
      }),
    );
  });
});

function result(id: string, cursor?: string): EvidenceApiInspectResult {
  const empty = <R extends Exclude<EvidenceRole, "verification">>(
    role: R,
  ): EvidenceApiRoleResult<R> => ({
    role,
    status: "not-yet-recorded" as const,
    activeRecordCount: 0,
    records: [],
    conflicting: false,
    truncated: false,
  });
  return {
    subject: { kind: "execution", id: "span_subject" },
    roles: {
      intent: empty("intent"),
      authority: empty("authority"),
      change: empty("change"),
      verification: {
        role: "verification",
        status: "present",
        activeRecordCount: 1,
        records: [
          {
            ref: {
              kind: "execution.evidence",
              id,
              subject: { kind: "execution", id: "span_subject" },
              role: "verification",
              evidenceKind: "custom.review",
              recordedAt: "2026-07-30T10:00:00.000Z",
            },
            source: { kind: "artifact", id: `artifact_${id}` },
            conclusion: "passed",
            supersedes: [],
            payloadState: "available",
          },
        ],
        conclusion: "passed",
        conflicting: false,
        truncated: Boolean(cursor),
        ...(cursor ? { cursor } : {}),
      },
      recovery: empty("recovery"),
    },
  };
}
