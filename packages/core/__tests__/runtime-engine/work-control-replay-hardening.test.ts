import { describe, expect, it } from "vitest";
import {
  inMemoryRuntimeStore,
  type InMemoryRuntimeStore,
} from "../../src/runtime/adapters/memory";
import {
  MAX_WORK_CONTROL_PAYLOAD_HASH_LENGTH,
  WORK_CONTROL_ERROR_CODES,
  acceptWorkControlCommand,
  type AcceptWorkControlCommandInput,
} from "../../src/runtime/engine/work-control";
import { transition } from "../../src/runtime/engine/work";
import type {
  LeaseToken,
  RuntimeTargetId,
  TaskId,
  WorkId,
} from "../../src/runtime/ports/ids";
import type { WorkControlRecord } from "../../src/runtime/ports/work-control";
import type {
  RuntimeStoreAdapter,
  RuntimeStoreTransaction,
} from "../../src/runtime/store";

describe("runtime Work-control replay hardening", () => {
  it("resolves persisted replay and conflict before bounds or Work existence", async () => {
    const store = inMemoryRuntimeStore();
    const workId = "work_replay" as WorkId;
    const command = commandFor(workId);
    await createWork(store, workId, command.namespace);

    const receipt = await acceptWorkControlCommand(clock(store), command);
    const pending = await store.state.getWork(workId, {
      namespace: command.namespace,
    });
    if (!pending) throw new Error("Expected Work fixture.");
    const leased = transition(pending, {
      status: "leased",
      leaseToken: "lease_replay" as LeaseToken,
    });
    await store.state.putWork(transition(leased, { status: "completed" }));
    await expect(
      store.state.pruneTerminalWork({
        namespace: command.namespace,
        before: new Date("2100-01-01T00:00:00.000Z"),
        limit: 1,
      }),
    ).resolves.toEqual({ removed: 1, truncated: false });

    await expect(
      acceptWorkControlCommand(clock(store), command),
    ).resolves.toEqual(receipt);
    for (const payloadHash of [
      "",
      "x".repeat(MAX_WORK_CONTROL_PAYLOAD_HASH_LENGTH + 1),
    ]) {
      await expect(
        acceptWorkControlCommand(clock(store), { ...command, payloadHash }),
      ).rejects.toMatchObject({
        code: WORK_CONTROL_ERROR_CODES.COMMAND_CONFLICT,
      });
    }
  });

  it("keeps NUL-containing command tuples distinct", async () => {
    const store = inMemoryRuntimeStore();
    const namespace = "tenant-a";
    const first = {
      ...commandFor("work" as WorkId),
      namespace,
      commandId: "part\0command",
      payloadHash: "sha256:first",
    } satisfies AcceptWorkControlCommandInput;
    const second = {
      ...commandFor("work\0part" as WorkId),
      namespace,
      commandId: "command",
      payloadHash: "sha256:second",
    } satisfies AcceptWorkControlCommandInput;
    await createWork(store, first.workId, namespace);
    await createWork(store, second.workId, namespace);

    await expect(
      acceptWorkControlCommand(clock(store), first),
    ).resolves.toMatchObject({ commandId: first.commandId });
    await expect(
      acceptWorkControlCommand(clock(store), second),
    ).resolves.toMatchObject({ commandId: second.commandId });
    await expect(store.workControl.get(first)).resolves.toMatchObject({
      payloadHash: first.payloadHash,
    });
    await expect(store.workControl.get(second)).resolves.toMatchObject({
      payloadHash: second.payloadHash,
    });
  });

  it("rejects a divergent record that wins create", async () => {
    const base = inMemoryRuntimeStore();
    const command = commandFor("work_race" as WorkId);
    await createWork(base, command.workId, command.namespace);
    const winner: WorkControlRecord = Object.freeze({
      ...command,
      payloadHash: "sha256:concurrent-winner",
      revision: 1,
      outcome: "accepted",
      createdAt: "2026-08-02T18:00:00.000Z",
      updatedAt: "2026-08-02T18:00:00.000Z",
    });
    const racingStore: RuntimeStoreAdapter = {
      ...base,
      async transact<T>(
        fn: (tx: RuntimeStoreTransaction) => Promise<T>,
      ): Promise<T> {
        return await base.transact(async (tx) =>
          await fn({
            ...tx,
            workControl: {
              async get() {
                return null;
              },
              async create() {
                return winner;
              },
            },
          }),
        );
      },
    };

    await expect(
      acceptWorkControlCommand(clock(racingStore), command),
    ).rejects.toMatchObject({
      code: WORK_CONTROL_ERROR_CODES.COMMAND_CONFLICT,
    });
  });
});

function commandFor(workId: WorkId): AcceptWorkControlCommandInput {
  return {
    namespace: "tenant-a",
    workId,
    commandId: "command_1",
    payloadHash: "sha256:original",
    acceptedAgentTargetId: "agent:researcher",
    resolvedPlanId: "plan:research:v1",
  };
}

function clock(store: RuntimeStoreAdapter) {
  return {
    store,
    now: () => new Date("2026-08-02T18:00:00.000Z"),
  };
}

async function createWork(
  store: InMemoryRuntimeStore,
  workId: WorkId,
  namespace: string,
): Promise<void> {
  await store.state.createWork({
    workId,
    namespace,
    work: {
      kind: "task.run",
      taskId: `task:${workId}` as TaskId,
      targetId: "runtime:researcher" as RuntimeTargetId,
    },
    targetId: "runtime:researcher" as RuntimeTargetId,
    idempotencyKey: `task:${workId}`,
    now: new Date("2026-08-02T17:59:00.000Z"),
  });
}
