import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import type {
  FlowId,
  FlowSnapshot,
  RuntimeTargetId,
  WorkId,
} from "@use-crux/core/runtime";
import schema from "../src/component/schema";
import { decodeSnapshot, encodeSnapshot } from "../src/runtime-engine/codec";

const modules = {
  "../src/component/_generated/server.ts": () =>
    import("../src/component/_generated/server"),
  "../src/component/runtime/state.ts": () =>
    import("../src/component/runtime/state"),
} satisfies Record<string, () => Promise<unknown>>;

const putSnapshot = makeFunctionReference<
  "mutation",
  { snapshot: Record<string, unknown> },
  null
>("runtime/state:putSnapshot");
const getSnapshot = makeFunctionReference<
  "mutation",
  { namespace: string; flowId: string },
  Record<string, unknown> | null
>("runtime/state:getSnapshot");

describe("Convex Runtime Flow Effects snapshots", () => {
  it("round-trips an optional Effect scope reference", async () => {
    const runtime = convexTest({ schema, modules });
    const snapshot: FlowSnapshot = {
      flowId: "flow_effects" as FlowId,
      workId: "work_effects" as WorkId,
      targetId: "review" as RuntimeTargetId,
      namespace: "tenant-a",
      status: "suspended",
      effects: {
        kind: "effect.scope",
        id: "effect-boundary:1",
        runId: "flow_effects",
      },
      input: {},
      completedSteps: {},
      fingerprint: [],
      pendingSuspends: [],
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };

    await runtime.mutation(putSnapshot, {
      snapshot: encodeSnapshot(snapshot),
    });

    const stored = await runtime.mutation(getSnapshot, {
      namespace: "tenant-a",
      flowId: "flow_effects",
    });
    expect(decodeSnapshot<FlowSnapshot>(stored)).toMatchObject({
      effects: snapshot.effects,
    });
  });
});
