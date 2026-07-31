import { describe, expect, it } from "vitest";
import { evidence, flow, observe } from "../../src";

describe("execution evidence", () => {
  it("records and inspects verification evidence inside an active flow step", async () => {
    const reviewFlow = flow("evidence-review", async (scope) =>
      scope.step("review", async () => {
        const context = observe.captureContext();
        const ref = evidence.record({
          role: "verification",
          conclusion: "passed",
          kind: "custom.editorial-review",
          data: { approved: true },
        });
        const view = await evidence.inspect(ref.subject, {
          includeData: true,
        });

        return { context, ref, view };
      }),
    );

    const result = await reviewFlow.run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;

    const { context, ref, view } = result.output;
    expect(context?.currentSpanId).toBeDefined();
    expect(ref).toMatchObject({
      kind: "execution.evidence",
      role: "verification",
      evidenceKind: "custom.editorial-review",
      subject: { kind: "execution", id: context?.currentSpanId },
    });
    expect(ref.id).toMatch(/^evidence_/u);
    expect(Date.parse(ref.recordedAt)).not.toBeNaN();
    expect(view).toMatchObject({
      subject: ref.subject,
      source: "active-scope",
      roles: {
        verification: {
          role: "verification",
          status: "present",
          conclusion: "passed",
          conflicting: false,
          truncated: false,
          records: [
            {
              ref,
              source: { kind: "artifact" },
              payloadState: "available",
              data: { approved: true },
            },
          ],
        },
      },
    });
  });
});
