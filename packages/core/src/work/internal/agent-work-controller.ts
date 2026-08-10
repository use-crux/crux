/**
 * Process-local Agent Work controller over the shared Work kernel.
 *
 * Owns occurrence identity and steering mailboxes only. Lifecycle acceptance
 * remains on the injected process-local kernel. First-accept is atomic under
 * concurrent callers: exactly one kernel child starts and waiters reconnect.
 * Terminal settlement disposes controller records and raw mailbox content while
 * preserving only in-turn occurrence replay until the owner execution ends.
 *
 * @internal
 * @module
 */

import type { AnyAgent, InferAgentOutput } from "../../agent/agent";
import type { AgentExecutor } from "../../agent/executor";
import type { Message } from "../../generation/messages";
import {
  createMemoryStatisticsLedger,
  type StatisticsOwner,
} from "../../statistics";
import type { AnyModel } from "../../types";
import type {
  AgentSteeringContent,
  AgentWorkHandle,
  WorkSteeringReceipt,
} from "../agent-handle";
import type { CancelOptions, CancelReceipt } from "../cancellation";
import type { DetachReceipt } from "../detachment";
import { WorkCancelledError, WorkFailedError, WorkNotActiveError } from "../errors";
import type { WorkEvent, WorkStreamOptions } from "../events";
import type { ExecutionStats } from "../handle";
import type { WorkProgress, WorkProgressSnapshot } from "../progress";
import type { WorkOwnership, WorkStatus } from "../status";
import {
  createAgentToolOccurrenceRegistry,
  encodeOccurrenceKey,
  type AgentToolOccurrenceKey,
  type AgentToolOccurrenceRegistry,
} from "./agent-occurrence";
import {
  createAgentSteeringMailbox,
  type AgentSteeringMailbox,
} from "./agent-steering";
import type { InternalWorkSpawnOptions } from "./attached-context";
import type {
  InternalWorkHandle,
  ProcessLocalWorkKernel,
} from "./process-local-kernel";

/** Controller that layers Agent semantics onto one process-local kernel. @internal */
export interface ProcessLocalAgentWorkController {
  readonly occurrences: AgentToolOccurrenceRegistry;
  spawnAgent<TAgent extends AnyAgent>(
    agent: TAgent,
    input: unknown,
    options: {
      readonly executor: AgentExecutor;
      readonly model?: AnyModel;
      readonly occurrence?: AgentToolOccurrenceKey;
      readonly spawn?: InternalWorkSpawnOptions;
      readonly targetLabel?: string;
    },
  ): Promise<AgentWorkHandle<InferAgentOutput<TAgent>>>;
  attachExisting<TOutput>(
    handle: InternalWorkHandle<TOutput>,
    options: {
      readonly targetId: string;
      readonly targetLabel: string;
      readonly occurrence?: AgentToolOccurrenceKey;
      readonly input?: unknown;
    },
  ): AgentWorkHandle<TOutput>;
  recover(workId: string): AgentWorkHandle<unknown> | undefined;
  /** Recover the internal kernel handle retained for one Agent Work id. */
  getInternal(workId: string): InternalWorkHandle<unknown> | undefined;
  acceptSteering(
    workId: string,
    content: AgentSteeringContent,
    commandId: string,
  ): Promise<WorkSteeringReceipt>;
  claimSteeringMessages(workId: string): readonly Message[];
  close(workId: string): void;
  /**
   * Drop occurrence entries for one parent owner execution after in-turn replay
   * is no longer required. Live child records remain until they terminalize.
   */
  releaseOwner(ownerId: string): void;
  isAgentWork(workId: string): boolean;
  /** Number of retained Agent Work controller records (tests/diagnostics). */
  recordCount(): number;
}

interface AgentWorkRecord<TOutput = unknown> {
  readonly handle: InternalWorkHandle<TOutput>;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly kind: "agent";
  readonly mailbox: AgentSteeringMailbox;
  readonly occurrence?: AgentToolOccurrenceKey;
  ownership: WorkOwnership;
  progress?: WorkProgressSnapshot;
  readonly acceptedAt: Date;
  nextCommand: number;
}

/** Create Agent Work support over one shared process-local kernel. */
export function createProcessLocalAgentWorkController(options: {
  readonly kernel: ProcessLocalWorkKernel;
  readonly now?: () => Date;
}): ProcessLocalAgentWorkController {
  const now = options.now ?? (() => new Date());
  const occurrences = createAgentToolOccurrenceRegistry();
  const records = new Map<string, AgentWorkRecord>();
  const pendingByOccurrence = new Map<
    string,
    Promise<AgentWorkHandle<unknown>>
  >();

  async function spawnAgent<TAgent extends AnyAgent>(
    agent: TAgent,
    input: unknown,
    spawnOptions: {
      readonly executor: AgentExecutor;
      readonly model?: AnyModel;
      readonly occurrence?: AgentToolOccurrenceKey;
      readonly spawn?: InternalWorkSpawnOptions;
      readonly targetLabel?: string;
    },
  ): Promise<AgentWorkHandle<InferAgentOutput<TAgent>>> {
    if (!spawnOptions.occurrence) {
      return spawnFresh(agent, input, spawnOptions);
    }

    const occurrence = spawnOptions.occurrence;
    const identity = encodeOccurrenceKey(occurrence);
    const existing = occurrences.get(occurrence);
    if (existing) {
      occurrences.accept(occurrence, input, existing.workId);
      const recovered = records.get(existing.workId);
      if (recovered) {
        return agentWorkHandle(recovered) as AgentWorkHandle<
          InferAgentOutput<TAgent>
        >;
      }
    }

    // Reserve the first accept before any await so concurrent callers reconnect.
    let starter = pendingByOccurrence.get(identity);
    if (!starter) {
      starter = spawnFresh(agent, input, spawnOptions)
        .then((handle) => handle as AgentWorkHandle<unknown>)
        .finally(() => {
          pendingByOccurrence.delete(identity);
        });
      pendingByOccurrence.set(identity, starter);
    }

    const handle = await starter;
    // Waiters validate their own input against the reserved occurrence.
    occurrences.accept(occurrence, input, handle.id);
    return handle as AgentWorkHandle<InferAgentOutput<TAgent>>;
  }

  async function spawnFresh<TAgent extends AnyAgent>(
    agent: TAgent,
    input: unknown,
    spawnOptions: {
      readonly executor: AgentExecutor;
      readonly model?: AnyModel;
      readonly occurrence?: AgentToolOccurrenceKey;
      readonly spawn?: InternalWorkSpawnOptions;
      readonly targetLabel?: string;
    },
  ): Promise<AgentWorkHandle<InferAgentOutput<TAgent>>> {
    const handle = await options.kernel.spawn(
      {
        run: async (context) => {
          const result = await spawnOptions.executor(agent, {
            input,
            model: spawnOptions.model,
            signal: context.signal,
            projectStepMessages: () =>
              claimSteeringMessages(context.id),
          });
          close(context.id);
          return result.output as InferAgentOutput<TAgent>;
        },
      },
      spawnOptions.spawn,
    );

    return attachExisting(handle, {
      targetId: agent.id,
      targetLabel: spawnOptions.targetLabel ?? agent.id,
      occurrence: spawnOptions.occurrence,
      input,
    });
  }

  function attachExisting<TOutput>(
    handle: InternalWorkHandle<TOutput>,
    attachOptions: {
      readonly targetId: string;
      readonly targetLabel: string;
      readonly occurrence?: AgentToolOccurrenceKey;
      readonly input?: unknown;
    },
  ): AgentWorkHandle<TOutput> {
    const existing = records.get(handle.id);
    if (existing) {
      return agentWorkHandle(existing) as AgentWorkHandle<TOutput>;
    }

    let occurrence: AgentToolOccurrenceKey | undefined;
    if (attachOptions.occurrence) {
      const accepted = occurrences.accept(
        attachOptions.occurrence,
        attachOptions.input,
        handle.id,
      );
      if (accepted.workId !== handle.id) {
        // Another concurrent starter won the occurrence. Cancel this orphan.
        handle.cancel();
        const winner = records.get(accepted.workId);
        if (winner) {
          return agentWorkHandle(winner) as AgentWorkHandle<TOutput>;
        }
        throw new TypeError(
          "Agent-tool occurrence was reserved by a concurrent spawn.",
        );
      }
      occurrence = attachOptions.occurrence;
    }

    const record: AgentWorkRecord = {
      handle: handle as InternalWorkHandle<unknown>,
      targetId: attachOptions.targetId,
      targetLabel: attachOptions.targetLabel,
      kind: "agent",
      mailbox: createAgentSteeringMailbox({
        workId: handle.id,
        now,
      }),
      ...(occurrence ? { occurrence } : {}),
      ownership: Object.freeze({ state: "attached" }),
      acceptedAt: now(),
      nextCommand: 0,
    };
    records.set(handle.id, record);

    void handle.result().then(
      () => {
        sealTerminal(handle.id);
      },
      () => {
        sealTerminal(handle.id);
      },
    );

    return agentWorkHandle(record) as AgentWorkHandle<TOutput>;
  }

  function recover(workId: string): AgentWorkHandle<unknown> | undefined {
    const record = records.get(workId);
    return record ? agentWorkHandle(record) : undefined;
  }

  function getInternal(
    workId: string,
  ): InternalWorkHandle<unknown> | undefined {
    return records.get(workId)?.handle;
  }

  async function acceptSteering(
    workId: string,
    content: AgentSteeringContent,
    commandId: string,
  ): Promise<WorkSteeringReceipt> {
    const record = records.get(workId);
    if (!record) {
      throw new TypeError(`Agent Work \`${workId}\` was not found.`);
    }
    return acceptRecordSteering(record, content, commandId);
  }

  function claimSteeringMessages(workId: string): readonly Message[] {
    const record = records.get(workId);
    if (!record) {
      return Object.freeze([]);
    }
    return record.mailbox.claimForProviderStep();
  }

  function close(workId: string): void {
    records.get(workId)?.mailbox.close();
  }

  /**
   * After a child terminals, drop raw steering content but keep the record so
   * in-turn occurrence replay can still rejoin the same result until the parent
   * owner execution releases its partition.
   */
  function sealTerminal(workId: string): void {
    const record = records.get(workId);
    if (!record) {
      return;
    }
    // Clears payload bytes and closes acceptance.
    record.mailbox.dispose();

    // Host-spawned Work has no occurrence partition: dispose the record now.
    // Agent-tool children keep the record for in-turn reconnect until the parent
    // owner releases its partition.
    if (
      !record.occurrence ||
      occurrences.get(record.occurrence) === undefined
    ) {
      records.delete(workId);
    }
  }

  function dispose(workId: string): void {
    const record = records.get(workId);
    if (!record) {
      return;
    }
    record.mailbox.dispose();
    records.delete(workId);
  }

  function releaseOwner(ownerId: string): void {
    occurrences.releaseOwner(ownerId);
    for (const [workId, record] of [...records.entries()]) {
      if (record.occurrence?.ownerId !== ownerId) {
        continue;
      }
      void record.handle.status().then((status) => {
        if (
          status.state === "completed" ||
          status.state === "failed" ||
          status.state === "cancelled"
        ) {
          dispose(workId);
        }
      });
    }
  }

  function isAgentWork(workId: string): boolean {
    return records.has(workId);
  }

  function recordCount(): number {
    return records.size;
  }

  return Object.freeze({
    occurrences,
    spawnAgent,
    attachExisting,
    recover,
    getInternal,
    acceptSteering,
    claimSteeringMessages,
    close,
    releaseOwner,
    isAgentWork,
    recordCount,
  });

  function agentWorkHandle<TOutput>(
    record: AgentWorkRecord<TOutput>,
  ): AgentWorkHandle<TOutput> {
    const { handle } = record;

    return Object.freeze({
      id: handle.id,
      effects: handle.effects,

      status: () => projectStatus(record),

      result: async () => {
        try {
          return await handle.result();
        } catch (failure) {
          const status = await projectStatus(record);
          if (status.state === "cancelled") {
            throw new WorkCancelledError(handle.id, status.reason);
          }
          if (status.state === "failed") {
            throw new WorkFailedError(handle.id, status.failure);
          }
          throw failure;
        }
      },

      progress: async (update: WorkProgress) => {
        const status = await handle.status();
        if (
          status.state === "completed" ||
          status.state === "failed" ||
          status.state === "cancelled"
        ) {
          throw new WorkNotActiveError(handle.id);
        }
        record.progress = validatedProgress(update, now());
      },

      cancel: async (cancelOptions?: CancelOptions) => {
        const cancelled = handle.cancel();
        if (cancelled) {
          await handle.result().catch(() => undefined);
          close(handle.id);
        }
        const status = await projectStatus(record, cancelOptions?.reason);
        return Object.freeze({
          workId: handle.id,
          outcome: cancelled ? "cancelled" : "already-terminal",
          status: terminalStatus(status),
        }) satisfies CancelReceipt;
      },

      detach: async () => {
        if (record.ownership.state === "detached") {
          return Object.freeze({
            workId: handle.id,
            outcome: "already-detached",
            ownership: record.ownership,
          }) satisfies DetachReceipt;
        }
        const status = await handle.status();
        if (
          status.state === "completed" ||
          status.state === "failed" ||
          status.state === "cancelled"
        ) {
          return Object.freeze({
            workId: handle.id,
            outcome: "already-terminal",
            ownership: record.ownership,
          }) satisfies DetachReceipt;
        }
        record.ownership = Object.freeze({
          state: "detached",
          reason: "explicit",
          detachedAt: now(),
        });
        return Object.freeze({
          workId: handle.id,
          outcome: "detached",
          ownership: record.ownership,
        }) satisfies DetachReceipt;
      },

      stream: (streamOptions?: WorkStreamOptions) =>
        streamAgentWork(record, streamOptions),

      stats: async () => processLocalStats(record),

      send: async (content: AgentSteeringContent) => {
        record.nextCommand += 1;
        return acceptRecordSteering(
          record,
          content,
          `send_${record.nextCommand}`,
        );
      },
    });
  }

  async function acceptRecordSteering(
    record: AgentWorkRecord,
    content: AgentSteeringContent,
    commandId: string,
  ): Promise<WorkSteeringReceipt> {
    const status = await record.handle.status();
    if (
      status.state === "completed" ||
      status.state === "failed" ||
      status.state === "cancelled"
    ) {
      throw new WorkNotActiveError(record.handle.id);
    }
    if (record.ownership.state === "detached") {
      // Application handles that retain capability may still steer. Model-facing
      // control uses owner recovery and will not reach detached records.
    }
    return record.mailbox.accept({ commandId, content });
  }
}

async function projectStatus(
  record: AgentWorkRecord,
  reason?: string,
): Promise<WorkStatus> {
  const status = await record.handle.status();
  const base = {
    id: status.id,
    ownership: record.ownership,
    updatedAt: status.updatedAt,
    ...(record.progress ? { progress: record.progress } : {}),
  };

  switch (status.state) {
    case "queued":
      return Object.freeze({
        ...base,
        state: "queued",
        acceptedAt: status.acceptedAt,
      });
    case "running":
    case "cancel-requested":
      return Object.freeze({
        ...base,
        state: "running",
        startedAt: status.startedAt,
      });
    case "completed":
      return Object.freeze({
        ...base,
        state: "completed",
        completedAt: status.completedAt,
        resultAvailable: status.resultAvailable,
      });
    case "failed":
      return Object.freeze({
        ...base,
        state: "failed",
        failedAt: status.failedAt,
        failure: Object.freeze({
          code: "process_local_failure",
          message: "Process-local Work failed.",
          retryable: false,
        }),
      });
    case "cancelled":
      return Object.freeze({
        ...base,
        state: "cancelled",
        cancelledAt: status.cancelledAt,
        ...(reason ? { reason } : {}),
      });
  }
}

function terminalStatus(
  status: WorkStatus,
): Extract<
  WorkStatus,
  { readonly state: "completed" | "failed" | "cancelled" }
> {
  if (
    status.state === "completed" ||
    status.state === "failed" ||
    status.state === "cancelled"
  ) {
    return status;
  }
  throw new Error("Process-local Work cancellation did not terminalize.");
}

function validatedProgress(
  update: WorkProgress,
  updatedAt: Date,
): WorkProgressSnapshot {
  if (update.message !== undefined) {
    if (typeof update.message !== "string" || update.message.length > 1_024) {
      throw new TypeError(
        "Work progress message must be at most 1,024 characters.",
      );
    }
  }
  if (update.current !== undefined) {
    if (
      typeof update.current !== "number" ||
      !Number.isFinite(update.current) ||
      update.current < 0
    ) {
      throw new TypeError(
        "Work progress current must be a finite non-negative number.",
      );
    }
  }
  if (update.total !== undefined) {
    if (
      typeof update.total !== "number" ||
      !Number.isFinite(update.total) ||
      update.total < 0
    ) {
      throw new TypeError(
        "Work progress total must be a finite non-negative number.",
      );
    }
  }
  if (
    update.current !== undefined &&
    update.total !== undefined &&
    update.current > update.total
  ) {
    throw new TypeError("Work progress current cannot exceed total.");
  }
  return Object.freeze({
    ...(update.message !== undefined ? { message: update.message } : {}),
    ...(update.current !== undefined ? { current: update.current } : {}),
    ...(update.total !== undefined ? { total: update.total } : {}),
    updatedAt,
  });
}

async function* streamAgentWork(
  record: AgentWorkRecord,
  options?: WorkStreamOptions,
): AsyncIterable<WorkEvent> {
  void options;
  let sequence = 0;
  const emit = async (
    type: "work.snapshot" | "work.status",
  ): Promise<WorkEvent> => {
    sequence += 1;
    const status = await projectStatus(record);
    return Object.freeze({
      id: `${record.handle.id}:${sequence}`,
      cursor: String(sequence),
      workId: record.handle.id,
      occurredAt: new Date(status.updatedAt.getTime()),
      type,
      status,
    });
  };

  yield await emit("work.snapshot");
  for (;;) {
    const status = await projectStatus(record);
    if (
      status.state === "completed" ||
      status.state === "failed" ||
      status.state === "cancelled"
    ) {
      yield await emit("work.status");
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

function processLocalStats(record: AgentWorkRecord): ExecutionStats {
  const ledger = createMemoryStatisticsLedger();
  const owner: StatisticsOwner = Object.freeze({
    kind: "work",
    id: record.handle.id,
  });
  ledger.record({
    owner,
    cursor: 1,
    at: record.acceptedAt,
    fact: { kind: "timing", activeTimeMs: 0, suspendedTimeMs: 0 },
  });
  return ledger.snapshot(owner)!.scope;
}
