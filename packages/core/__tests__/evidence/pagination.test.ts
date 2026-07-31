import { describe, expect, it } from "vitest";
import { evidence, flow } from "../../src";

describe("evidence local pagination", () => {
  it("retains the newest 50 rows and pages a selected role with opaque cursors", async () => {
    const result = await flow("bounded-evidence", async (scope) =>
      scope.step("record", async () => {
        let subject: ReturnType<typeof evidence.record>["subject"] | undefined;
        for (let index = 0; index < 51; index += 1) {
          subject = evidence.record({
            role: "verification",
            conclusion: "passed",
            kind: "custom.check",
            data: { index },
          }).subject;
        }
        if (!subject) throw new Error("test setup did not record evidence");

        const first = await evidence.inspect(subject, {
          role: "verification",
          limit: 10,
          includeData: true,
        });
        const second = await evidence.inspect(subject, {
          role: "verification",
          limit: 10,
          cursor: first.roles.verification.cursor,
          includeData: true,
        });
        const unscoped = await evidence.inspect(subject, {
          limit: 10,
          includeData: true,
        });
        return { subject, first, second, unscoped };
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const { first, second, unscoped } = result.output;
    expect(first.roles.verification.records).toHaveLength(10);
    expect(first.roles.verification.records[0]?.data).toEqual({ index: 1 });
    expect(first.roles.verification).toMatchObject({
      status: "present",
      conclusion: "passed",
      conflicting: false,
      truncated: true,
      cursor: expect.any(String),
    });
    expect(second.roles.verification.records).toHaveLength(10);
    expect(second.roles.verification.records[0]?.data).toEqual({ index: 11 });
    expect(
      new Set([
        ...first.roles.verification.records.map(({ ref }) => ref.id),
        ...second.roles.verification.records.map(({ ref }) => ref.id),
      ]).size,
    ).toBe(20);
    expect(unscoped.roles.verification.records).toHaveLength(10);
    expect(unscoped.roles.verification).not.toHaveProperty("cursor");
    expect(unscoped.roles.verification.truncated).toBe(true);
  });

  it("keeps non-selected aggregate summaries without hydrating their rows", async () => {
    const result = await flow("selected-evidence-role", async (scope) =>
      scope.step("record", async () => {
        const verification = evidence.record({
          role: "verification",
          conclusion: "passed",
          kind: "custom.check",
          data: {},
        });
        evidence.record({
          role: "change",
          conclusion: "applied",
          kind: "custom.change",
          data: {},
        });
        return evidence.inspect(verification.subject, {
          role: "verification",
        });
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.roles.verification.records).toHaveLength(1);
    expect(result.output.roles.change).toMatchObject({
      status: "present",
      conclusion: "applied",
      conflicting: false,
      records: [],
    });
    expect(result.output.roles.change).not.toHaveProperty("history");
    expect(result.output.roles.change).not.toHaveProperty("cursor");
  });

  it("omits the cursor on the final retained page", async () => {
    const result = await flow("final-evidence-page", async (scope) =>
      scope.step("record", async () => {
        let subject: ReturnType<typeof evidence.record>["subject"] | undefined;
        for (let index = 0; index < 12; index += 1) {
          subject = evidence.record({
            role: "verification",
            kind: "custom.check",
            data: { index },
          }).subject;
        }
        if (!subject) throw new Error("test setup did not record evidence");
        const pages = [];
        let cursor: string | undefined;
        do {
          const page = await evidence.inspect(subject, {
            role: "verification",
            limit: 5,
            ...(cursor ? { cursor } : {}),
          });
          pages.push(page.roles.verification);
          cursor = page.roles.verification.cursor;
        } while (cursor);
        return pages;
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.map(({ records }) => records.length)).toEqual([
      5, 5, 2,
    ]);
    expect(result.output[2]).not.toHaveProperty("cursor");
    expect(result.output[2]?.truncated).toBe(false);
  });

  it("rejects a cursor after the local snapshot changes", async () => {
    const result = await flow("stale-evidence-page", async (scope) =>
      scope.step("record", async () => {
        const first = evidence.record({
          role: "verification",
          kind: "custom.check",
          data: { index: 0 },
        });
        for (let index = 1; index < 3; index += 1) {
          evidence.record({
            role: "verification",
            kind: "custom.check",
            data: { index },
          });
        }
        const page = await evidence.inspect(first.subject, {
          role: "verification",
          limit: 1,
        });
        evidence.record({
          role: "verification",
          kind: "custom.check",
          data: { index: 3 },
        });
        await expect(
          evidence.inspect(first.subject, {
            role: "verification",
            limit: 1,
            cursor: page.roles.verification.cursor,
          }),
        ).rejects.toMatchObject({
          code: "EVIDENCE_CURSOR_INVALID",
        });
      }),
    ).run();

    expect(result.status).toBe("completed");
  });
});
