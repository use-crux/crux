import { describe, expect, it } from "vitest";
import { decodeFlowSnapshot, decodeWorkItem } from "../src/runtime/codec";

describe("Postgres Runtime codec", () => {
  it("preserves canonical application Work metadata losslessly", () => {
    const application = {
      schemaVersion: 1 as const,
      updatedAt: "2026-08-03T00:00:01.000Z",
      ownership: {
        state: "detached" as const,
        reason: "explicit" as const,
        detachedAt: "2026-08-03T00:00:01.000Z",
      },
      progress: {
        message: "Stored",
        current: 1,
        total: 2,
        updatedAt: "2026-08-03T00:00:00.500Z",
      },
      statistics: {
        version: 1 as const,
        owner: { kind: "work" as const, id: "work_1" },
        cursor: 3,
        state: "opaque-ledger-state",
      },
      latestEventCursor: "42",
    };

    const work = decodeWorkItem({
      work_id: "work_1",
      namespace: "tenant-a",
      work: { kind: "flow.resume", flowId: "flow_1" },
      target_id: "review",
      status: "pending",
      attempt: 1,
      max_attempts: 8,
      idempotency_key: "request_1",
      application,
      created_at: "2026-08-03T00:00:00.000Z",
      updated_at: "2026-08-03T00:00:00.000Z",
    });

    expect(work.application).toEqual(application);
  });

  it("revives pending flow timeout deadlines", () => {
    const deadline = new Date("2026-07-18T01:00:00.000Z");
    const snapshot = decodeFlowSnapshot({
      flow_id: "flow_timeout",
      work_id: "work_timeout",
      target_id: "review",
      namespace: "tenant-a",
      status: "suspended",
      input: {},
      completed_steps: {},
      fingerprint: [],
      pending_suspends: [
        { label: "approval", timeoutAt: deadline.toISOString() },
      ],
      delivered_suspends: null,
      scheduled_work: null,
      updated_at: deadline.toISOString(),
    });

    expect(snapshot.pendingSuspends[0]?.timeoutAt).toEqual(deadline);
  });

  it("preserves a Flow Effect scope reference", () => {
    const snapshot = decodeFlowSnapshot({
      flow_id: "flow_effects",
      work_id: "work_effects",
      target_id: "review",
      namespace: "tenant-a",
      status: "suspended",
      effects: {
        kind: "effect.scope",
        id: "effect-boundary:1",
        runId: "flow_effects",
      },
      input: {},
      completed_steps: {},
      fingerprint: [],
      pending_suspends: [],
      delivered_suspends: null,
      scheduled_work: null,
      updated_at: "2026-08-01T00:00:00.000Z",
    });

    expect(snapshot.effects).toEqual({
      kind: "effect.scope",
      id: "effect-boundary:1",
      runId: "flow_effects",
    });
  });
});
