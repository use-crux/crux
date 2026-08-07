/**
 * Provider-neutral Session conformance contracts.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { registerSessionRecoveryConformance } from "./recovery-conformance";
import { registerSessionResultConformance } from "./result-conformance";
import { registerSessionInspectionConformance } from "./inspection-conformance";
import { registerSessionCapabilityConformance } from "./capability-conformance";
import { registerSessionLifecycleConformance } from "./lifecycle-conformance";
import type {
  RunSessionConformanceTestsOptions,
  SessionConformanceWorker,
} from "./types";

export type {
  RunSessionConformanceTestsOptions,
  SessionConformanceExecutionCounts,
  SessionConformanceFaultBoundary,
  SessionConformanceHarness,
  SessionConformanceInput,
  SessionConformanceOutput,
  SessionConformanceWorker,
} from "./types";

/**
 * Register provider-neutral durable Session behavior checks.
 *
 * @remarks Adapter packages supply only substrate setup and observation seams;
 * every law executes the public Session, Thread, and Work handles unchanged.
 */
export function runSessionConformanceTests(
  options: RunSessionConformanceTestsOptions,
): void {
  describe(`${options.name} Session conformance`, () => {
    it("keeps keyed identity atomic and enforces one Thread owner", async () => {
      const harness = await options.createHarness("keyed-identity");
      try {
        const [first, second] = await Promise.all([
          harness.create("shared-key"),
          harness.create("shared-key"),
        ]);
        const reopened = await harness.get("shared-key");

        expect(second.id).toBe(first.id);
        expect(reopened.id).toBe(first.id);
        await expect(
          harness.createConflict("shared-key"),
        ).rejects.toMatchObject({
          code: "SESSION_IDENTITY_CONFLICT",
        });
        await expect(harness.ownerIds(first.thread.id)).resolves.toEqual([
          first.id,
        ]);
      } finally {
        await harness.dispose();
      }
    });

    it("serializes simultaneous create and send acceptance", async () => {
      const harness = await options.createHarness("concurrent-acceptance");
      try {
        const sessions = await Promise.all([
          harness.create("concurrent-key"),
          harness.create("concurrent-key"),
        ]);
        const turns = await Promise.all([
          sessions[0]!.send({ message: "first" }),
          sessions[1]!.send({ message: "second" }),
        ]);

        expect(new Set(turns.map((turn) => turn.cursor))).toEqual(
          new Set(["1", "2"]),
        );
        await expect(sessions[0]!.status()).resolves.toMatchObject({
          acceptedCursor: "2",
          pendingInputs: 2,
          pendingWork: 1,
        });
      } finally {
        await harness.dispose();
      }
    });

    it("claims an ordered compatible prefix onto one canonical Work", async () => {
      const harness = await options.createHarness("compatible-prefix");
      let worker: SessionConformanceWorker | undefined;
      try {
        const conversation = await harness.create("prefix-key");
        const [first, second] = await conversation.sendMany([
          { message: "first" },
          { message: "second" },
        ]);
        worker = await harness.startWorker();

        await expect(
          Promise.all([first!.result(), second!.result()]),
        ).resolves.toEqual([
          { reply: "Echo: first" },
          { reply: "Echo: first" },
        ]);
        const [firstWork, secondWork] = await Promise.all([
          first!.work(),
          second!.work(),
        ]);
        expect(secondWork.id).toBe(firstWork.id);
        expect(harness.executionCounts()).toEqual({
          executor: 1,
          provider: 2,
          tool: 1,
          effect: 1,
        });
        await expect(conversation.inspect()).resolves.toMatchObject({
          inputs: [
            { id: first!.id, delivery: { stepIndex: 0, reason: "initial" } },
            { id: second!.id, delivery: { stepIndex: 0, reason: "initial" } },
          ],
        });
      } finally {
        await worker?.stop();
        await harness.dispose();
      }
    });

    registerSessionRecoveryConformance(options);
    registerSessionResultConformance(options);
    registerSessionInspectionConformance(options);
    registerSessionCapabilityConformance(options);
    registerSessionLifecycleConformance(options);
  });
}
