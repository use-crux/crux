import { describe, expect, it } from "vitest";
import { evidence, flow } from "../../src";

describe("evidence supersession read model", () => {
  it("derives active and history only from explicit supersession", async () => {
    const result = await flow("evidence-history", async (scope) =>
      scope.step("record", async () => {
        const first = evidence.record({
          role: "verification",
          conclusion: "failed",
          observedAt: "2030-01-01T00:00:00.000Z",
          kind: "custom.check",
          data: { attempt: 1 },
        });
        const second = evidence.record({
          role: "verification",
          observedAt: "2020-01-01T00:00:00.000Z",
          kind: "custom.check",
          data: { attempt: 2 },
          supersedes: first,
        });
        const third = evidence.record({
          role: "verification",
          conclusion: "passed",
          observedAt: "2010-01-01T00:00:00.000Z",
          kind: "custom.check",
          data: { attempt: 3 },
          supersedes: second,
        });
        return {
          first,
          second,
          third,
          activeOnly: await evidence.inspect(first.subject),
          withHistory: await evidence.inspect(first.subject, {
            includeHistory: true,
          }),
        };
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const { first, second, third, activeOnly, withHistory } = result.output;
    expect(activeOnly.roles.verification.records.map(({ ref }) => ref)).toEqual([
      third,
    ]);
    expect(activeOnly.roles.verification).not.toHaveProperty("history");
    expect(withHistory.roles.verification.history?.map(({ ref }) => ref)).toEqual(
      [first, second],
    );
    expect(withHistory.roles.verification).toMatchObject({
      conclusion: "passed",
      conflicting: false,
      status: "present",
    });
    expect(Object.isFrozen(withHistory)).toBe(true);
    expect(Object.isFrozen(withHistory.roles)).toBe(true);
    expect(Object.isFrozen(withHistory.roles.verification)).toBe(true);
    expect(Object.isFrozen(withHistory.roles.verification.records)).toBe(true);
    expect(Object.isFrozen(withHistory.roles.verification.history)).toBe(true);
  });

  it("supports one record superseding several prior claims", async () => {
    const result = await flow("evidence-multi-supersession", async (scope) =>
      scope.step("record", async () => {
        const first = evidence.record({
          role: "change",
          conclusion: "no-change",
          kind: "custom.attempt",
          data: { attempt: 1 },
        });
        const second = evidence.record({
          role: "change",
          conclusion: "unknown",
          kind: "custom.attempt",
          data: { attempt: 2 },
        });
        const final = evidence.record({
          role: "change",
          conclusion: "applied",
          kind: "custom.attempt",
          data: { attempt: 3 },
          supersedes: [first, second],
        });
        return {
          first,
          second,
          final,
          view: await evidence.inspect(first.subject, {
            includeHistory: true,
          }),
        };
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.view.roles.change.records.map(({ ref }) => ref)).toEqual(
      [result.output.final],
    );
    expect(
      result.output.view.roles.change.history?.map(({ ref }) => ref),
    ).toEqual([result.output.first, result.output.second]);
  });

  it("reports conflict only for distinct classified active conclusions", async () => {
    const result = await flow("evidence-conflict", async (scope) =>
      scope.step("record", async () => {
        const first = evidence.record({
          role: "verification",
          conclusion: "passed",
          kind: "custom.check",
          data: { source: 1 },
        });
        evidence.record({
          role: "verification",
          conclusion: "failed",
          kind: "custom.check",
          data: { source: 2 },
        });
        evidence.record({
          role: "verification",
          kind: "custom.note",
          data: { source: 3 },
        });
        return evidence.inspect(first.subject);
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.roles.verification).toMatchObject({
      records: expect.arrayContaining([
        expect.objectContaining({ conclusion: "passed" }),
        expect.objectContaining({ conclusion: "failed" }),
        expect.not.objectContaining({ conclusion: expect.anything() }),
      ]),
      conflicting: true,
    });
    expect(result.output.roles.verification).not.toHaveProperty("conclusion");
  });

  it("keeps an agreed conclusion alongside unclassified evidence", async () => {
    const result = await flow("evidence-agreement", async (scope) =>
      scope.step("record", async () => {
        const first = evidence.record({
          role: "authority",
          conclusion: "allowed",
          kind: "custom.policy",
          data: { source: 1 },
        });
        evidence.record({
          role: "authority",
          conclusion: "allowed",
          kind: "custom.policy",
          data: { source: 2 },
        });
        evidence.record({
          role: "authority",
          kind: "custom.note",
          data: { source: 3 },
        });
        return evidence.inspect(first.subject);
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.roles.authority).toMatchObject({
      conclusion: "allowed",
      conflicting: false,
      records: expect.arrayContaining([
        expect.not.objectContaining({ conclusion: expect.anything() }),
      ]),
    });
  });
});
