import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RuntimeInspectResponse } from "../types";
import { RuntimeWorkDetail } from "./RuntimeWorkDetail";

describe("RuntimeWorkDetail", () => {
  it("shows durable application Work identity and result lineage", () => {
    const detail = {
      operation: "inspect",
      ok: true,
      namespace: "local",
      work: {
        workId: "work_1",
        namespace: "local",
        targetId: "review",
        status: "completed",
        work: { kind: "flow.resume" },
        attempt: 2,
        maxAttempts: 8,
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:01.000Z",
      },
      application: {
        inputDigest: "digest_1",
        definition: {
          targetId: "review",
          definitionId: "flow:review",
          fingerprint: "definition-v1",
          manifestHash: "manifest-v1",
        },
        effects: {
          kind: "effect.scope",
          id: "effect_1",
          runId: "work_1",
        },
        ownership: { state: "detached" },
        statistics: { version: 1, facts: [] },
        result: { available: true, ref: { sha256: "result_1" } },
        events: [{ eventId: "event_1", name: "crux.work:work_1" }],
      },
    } as unknown as RuntimeInspectResponse;

    const html = renderToStaticMarkup(<RuntimeWorkDetail detail={detail} />);

    expect(html).toContain("digest_1");
    expect(html).toContain("flow:review");
    expect(html).toContain("definition-v1");
    expect(html).toContain("effect_1");
    expect(html).toContain("detached");
    expect(html).toContain("result_1");
    expect(html).toContain("1 event");
  });
});
