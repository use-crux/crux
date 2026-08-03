import { describe, expect, it } from "vitest";
import {
  runtimeFlowSnapshot,
  type RuntimeFlowExecution,
} from "../../src/flow/runtime-engine";
import type { EffectScopeRef } from "../../src/effect";
import type { FlowSnapshot } from "../../src/runtime/ports/state";
import type { RuntimeWorkItem } from "../../src/runtime/engine/work";

describe("durable application Work snapshot", () => {
  it("retains the accepted definition and result obligation at Flow barriers", () => {
    const now = new Date("2026-08-03T00:00:00.000Z");
    const effects: EffectScopeRef = {
      kind: "effect.scope",
      id: "effect_work_1",
      runId: "work_1",
    };
    const work = {
      workId: "work_1",
      namespace: "application-test",
      targetId: "review",
    } as RuntimeWorkItem;
    const accepted = {
      flowId: "flow_1",
      workId: "work_1",
      targetId: "review",
      namespace: "application-test",
      status: "running",
      definition: {
        targetId: "review",
        definitionId: "flow:review",
        fingerprint: "definition-review-v1",
        manifestHash: "manifest-v1",
      },
      resultObligation: { kind: "required" },
      effects,
      input: { documentId: "doc_1" },
      completedSteps: {},
      fingerprint: [],
      pendingSuspends: [],
      updatedAt: now,
    } as FlowSnapshot;
    const execution = {
      runtime: { now: () => now },
      work,
      snapshot: accepted,
      fingerprint: { observed: [] },
    } as RuntimeFlowExecution;

    expect(
      runtimeFlowSnapshot(execution, {
        status: "completed",
        effects,
        input: accepted.input,
        completedSteps: {},
      }),
    ).toMatchObject({
      definition: accepted.definition,
      resultObligation: { kind: "required" },
    });
  });
});
