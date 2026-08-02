import { describe, expect, it } from "vitest";
import { inMemoryRuntimeStore } from "../../src/runtime/adapters/memory";
import {
  MAX_WORK_CONTROL_PAYLOAD_HASH_LENGTH,
  WORK_CONTROL_ERROR_CODES,
  acceptWorkControlCommand,
  type AcceptWorkControlCommandInput,
} from "../../src/runtime/engine/work-control";
import type {
  RuntimeTargetId,
  TaskId,
  WorkId,
} from "../../src/runtime/ports/ids";

describe("runtime Work-control steering", () => {
  it("accepts one immutable command idempotently within its Work namespace", async () => {
    const store = inMemoryRuntimeStore();
    const workId = "work_steering_1" as WorkId;
    const acceptedAt = new Date("2026-08-02T16:00:00.000Z");
    const command = {
      namespace: "tenant-a",
      workId,
      commandId: "command_1",
      payloadHash: "sha256:4d6f726520636f6e74657874",
      acceptedAgentTargetId: "agent:researcher",
      resolvedPlanId: "plan:research:v1",
    } satisfies AcceptWorkControlCommandInput;

    await store.state.createWork({
      workId,
      namespace: command.namespace,
      work: {
        kind: "task.run",
        taskId: "task_steering_1" as TaskId,
        targetId: "runtime:researcher" as RuntimeTargetId,
      },
      targetId: "runtime:researcher" as RuntimeTargetId,
      idempotencyKey: "task:work_steering_1",
      now: new Date("2026-08-02T15:59:00.000Z"),
    });
    const workBefore = await store.state.getWork(workId, {
      namespace: command.namespace,
    });

    store.testing.failAfter(0);
    await expect(
      acceptWorkControlCommand(
        { store, now: () => acceptedAt },
        command,
      ),
    ).rejects.toThrow("Injected transaction failure");
    await expect(store.workControl.get(command)).resolves.toBeNull();

    const receipt = await acceptWorkControlCommand(
      { store, now: () => acceptedAt },
      command,
    );
    const receiptJson = JSON.stringify(receipt);

    expect(Object.isFrozen(receipt)).toBe(true);
    expect(receipt).toEqual({
      namespace: command.namespace,
      workId,
      commandId: command.commandId,
      acceptedAgentTargetId: command.acceptedAgentTargetId,
      resolvedPlanId: command.resolvedPlanId,
      revision: 1,
      outcome: "accepted",
      createdAt: acceptedAt.toISOString(),
      updatedAt: acceptedAt.toISOString(),
    });

    const stored = await store.workControl.get(command);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(stored).toEqual({
      ...receipt,
      payloadHash: command.payloadHash,
    });
    expect(stored).not.toHaveProperty("payload");

    store.testing.failAfter(0);
    const replay = await acceptWorkControlCommand(
      {
        store,
        now: () => new Date("2026-08-02T17:00:00.000Z"),
      },
      command,
    );
    expect(JSON.stringify(replay)).toBe(receiptJson);

    const conflicts: readonly AcceptWorkControlCommandInput[] = [
      { ...command, payloadHash: "sha256:different" },
      { ...command, acceptedAgentTargetId: "agent:writer" },
      { ...command, resolvedPlanId: "plan:research:v2" },
    ];
    for (const conflict of conflicts) {
      store.testing.failAfter(0);
      await expect(
        acceptWorkControlCommand(
          { store, now: () => acceptedAt },
          conflict,
        ),
      ).rejects.toMatchObject({
        code: WORK_CONTROL_ERROR_CODES.COMMAND_CONFLICT,
      });
    }

    await expect(store.workControl.get(command)).resolves.toEqual(stored);
    await expect(
      store.workControl.get({ ...command, namespace: "tenant-b" }),
    ).resolves.toBeNull();
    await expect(
      acceptWorkControlCommand(
        { store, now: () => acceptedAt },
        { ...command, namespace: "tenant-b" },
      ),
    ).rejects.toMatchObject({
      code: WORK_CONTROL_ERROR_CODES.WORK_NOT_FOUND,
    });

    await expect(
      acceptWorkControlCommand(
        { store, now: () => acceptedAt },
        {
          ...command,
          commandId: "command_too_large",
          payloadHash: "x".repeat(MAX_WORK_CONTROL_PAYLOAD_HASH_LENGTH + 1),
        },
      ),
    ).rejects.toThrow(
      `Work control payloadHash must contain 1 to ${MAX_WORK_CONTROL_PAYLOAD_HASH_LENGTH} characters.`,
    );

    await expect(
      store.state.getWork(workId, { namespace: command.namespace }),
    ).resolves.toEqual(workBefore);
  });
});
