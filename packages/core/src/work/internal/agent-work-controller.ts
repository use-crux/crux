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
import {
  WorkAdmissionError,
  WorkCancelledError,
  WorkFailedError,
  WorkNotActiveError,
} from "../errors";
import type { WorkEvent, WorkStreamOptions } from "../events";
import type { ExecutionStats } from "../handle";
import {
  intersectResolvedWorkPolicy,
  resolveWorkPolicy,
  type ResolvedWorkPolicy,
} from "../policy";
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
      readonly policy?: ResolvedWorkPolicy;
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

interface AgentWorkTopology {
  readonly rootId: string;
  readonly parentWorkId?: string;
  readonly depth: number;
  readonly policy: ResolvedWorkPolicy;
}

interface RootTreeLedger {
  starts: number;
  active: number;
  rootTerminal: boolean;
}

interface AgentWorkRecord<TOutput = unknown> {
  readonly handle: InternalWorkHandle<TOutput>;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly kind: "agent";
  readonly mailbox: AgentSteeringMailbox;
  readonly occurrence?: AgentToolOccurrenceKey;
  readonly rootId: string;
  readonly parentWorkId?: string;
  readonly depth: number;
  readonly policy: ResolvedWorkPolicy;
  readonly releaseOwnerOutstanding?: () => void;
  ownership: WorkOwnership;
  progress?: WorkProgressSnapshot;
  readonly acceptedAt: Date;
  nextCommand: number;
}

/** Create Agent Work support over one shared process-local kernel. */
export function createProcessLocalAgentWorkController(options: {
  readonly kernel: ProcessLocalWorkKernel;
  readonly now?: () => Date;
  readonly policy?: ResolvedWorkPolicy;
}): ProcessLocalAgentWorkController {
  const now = options.now ?? (() => new Date());
  const hostPolicy = options.policy ?? resolveWorkPolicy();
  const occurrences = createAgentToolOccurrenceRegistry();
  const records = new Map<string, AgentWorkRecord>();
  const rootLedgers = new Map<string, RootTreeLedger>();
  const pendingByOccurrence = new Map<
    string,
    Promise<AgentWorkHandle<unknown>>
  >();

  // Per-owner admission gate: one atomic FIFO gate per owning execution. Host
  // spawns without an occurrence share the controller's host owner.
  interface AdmissionEntry {
    state: "queued" | "running" | "settled";
    outstandingReleased: boolean;
    readonly start: () => void;
    readonly settle: () => void;
    readonly releaseOutstanding: () => void;
  }

  interface AdmissionGateState {
    running: number;
    outstanding: number;
    queue: AdmissionEntry[];
  }

  const gates = new Map<string | symbol, AdmissionGateState>();
  const hostOwnerKey = Symbol("process-local-agent-work-host-owner");

  function ensureAdmissionGate(ownerKey: string | symbol): AdmissionGateState {
    let gate = gates.get(ownerKey);
    if (!gate) {
      gate = { running: 0, outstanding: 0, queue: [] };
      gates.set(ownerKey, gate);
    }
    return gate;
  }

  function admit(
    ownerKey: string | symbol,
    gate: AdmissionGateState,
    policy: ResolvedWorkPolicy,
    start: () => void,
  ): AdmissionEntry {
    const entry: AdmissionEntry = {
      state: "queued",
      outstandingReleased: false,
      start,
      settle: () => settleEntry(ownerKey, gate, entry),
      releaseOutstanding: () => releaseEntryOutstanding(gate, entry),
    };

    if (gate.running < policy.concurrency) {
      entry.state = "running";
      gate.running += 1;
      entry.start();
    } else {
      gate.queue.push(entry);
    }

    return entry;
  }

  function settleEntry(
    ownerKey: string | symbol,
    gate: AdmissionGateState,
    entry: AdmissionEntry,
  ): void {
    if (entry.state === "settled") {
      return;
    }

    releaseEntryOutstanding(gate, entry);

    if (entry.state === "queued") {
      entry.state = "settled";
      removeEntry(gate.queue, entry);
    } else {
      entry.state = "settled";
      gate.running -= 1;
      promoteNext(gate);
    }

    maybeDeleteGate(ownerKey, gate);
  }

  function releaseEntryOutstanding(
    gate: AdmissionGateState,
    entry: AdmissionEntry,
  ): void {
    if (entry.outstandingReleased) {
      return;
    }
    entry.outstandingReleased = true;
    gate.outstanding -= 1;
  }

  function removeEntry(queue: AdmissionEntry[], entry: AdmissionEntry): void {
    const index = queue.indexOf(entry);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  }

  function promoteNext(gate: AdmissionGateState): void {
    const index = gate.queue.findIndex((entry) => entry.state === "queued");
    if (index === -1) {
      return;
    }
    const [entry] = gate.queue.splice(index, 1);
    entry.state = "running";
    gate.running += 1;
    entry.start();
  }

  function maybeDeleteGate(
    ownerKey: string | symbol,
    gate: AdmissionGateState,
  ): void {
    if (
      gate.outstanding === 0 &&
      gate.running === 0 &&
      gate.queue.length === 0
    ) {
      gates.delete(ownerKey);
    }
  }

  function ensureRootLedger(rootId: string): RootTreeLedger {
    let ledger = rootLedgers.get(rootId);
    if (!ledger) {
      ledger = { starts: 0, active: 0, rootTerminal: false };
      rootLedgers.set(rootId, ledger);
    }
    return ledger;
  }

  function settleRootTerminal(rootId: string): void {
    const ledger = rootLedgers.get(rootId);
    if (!ledger) {
      return;
    }
    ledger.rootTerminal = true;
    maybeDeleteRootLedger(rootId, ledger);
  }

  function settleDescendant(rootId: string): void {
    const ledger = rootLedgers.get(rootId);
    if (!ledger) {
      return;
    }
    ledger.active -= 1;
    maybeDeleteRootLedger(rootId, ledger);
  }

  function maybeDeleteRootLedger(rootId: string, ledger: RootTreeLedger): void {
    if (ledger.rootTerminal && ledger.active === 0) {
      rootLedgers.delete(rootId);
    }
  }

  function attachTreeSettlement(
    handle: InternalWorkHandle<unknown>,
    onSettle: () => void,
  ): void {
    let settled = false;
    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      onSettle();
    };
    void handle.result().then(settle, settle);
  }

  async function spawnAgent<TAgent extends AnyAgent>(
    agent: TAgent,
    input: unknown,
    spawnOptions: {
      readonly executor: AgentExecutor;
      readonly model?: AnyModel;
      readonly occurrence?: AgentToolOccurrenceKey;
      readonly spawn?: InternalWorkSpawnOptions;
      readonly targetLabel?: string;
      readonly policy?: ResolvedWorkPolicy;
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
      readonly policy?: ResolvedWorkPolicy;
    },
  ): Promise<AgentWorkHandle<InferAgentOutput<TAgent>>> {
    const parent =
      spawnOptions.spawn?.kind === "attached"
        ? records.get(spawnOptions.spawn.attachment.parentId)
        : undefined;

    const depth = parent ? parent.depth + 1 : 0;

    let policy = hostPolicy;

    if (spawnOptions.policy) {
      policy = intersectResolvedWorkPolicy(policy, spawnOptions.policy);
    }

    if (parent) {
      policy = intersectResolvedWorkPolicy(policy, parent.policy);
    }

    if (depth > policy.tree.maxDepth) {
      throw new WorkAdmissionError({ code: "work_admission_max_depth" });
    }

    // Tree admission for known parents, ahead of owner admission. A child
    // consumes one start and one active slot in its root's ledger.
    let treeLedger: RootTreeLedger | undefined;
    if (parent) {
      treeLedger = ensureRootLedger(parent.rootId);
      if (treeLedger.starts >= policy.tree.maxStarts) {
        throw new WorkAdmissionError({ code: "work_admission_max_starts" });
      }
      if (treeLedger.active >= policy.tree.maxActive) {
        throw new WorkAdmissionError({ code: "work_admission_max_active" });
      }
    }

    const ownerKey = spawnOptions.occurrence?.ownerId ?? hostOwnerKey;
    const gate = ensureAdmissionGate(ownerKey);

    // Atomic admission: reject before acceptance and before the executor is
    // reached. Synchronous check plus increment keeps concurrent callers safe.
    if (gate.outstanding >= policy.maxOutstanding) {
      throw new WorkAdmissionError();
    }
    gate.outstanding += 1;

    // Tentative tree acceptance, committed only if kernel.spawn succeeds.
    if (treeLedger) {
      treeLedger.starts += 1;
      treeLedger.active += 1;
    }

    let entry: AdmissionEntry | undefined;

    let handle: InternalWorkHandle<InferAgentOutput<TAgent>>;
    try {
      handle = await options.kernel.spawn(
        {
          run: async (context) => {
            const result = await spawnOptions.executor(agent, {
              input,
              model: spawnOptions.model,
              signal: context.signal,
              projectStepMessages: () => claimSteeringMessages(context.id),
            });
            close(context.id);
            return result.output as InferAgentOutput<TAgent>;
          },
        },
        spawnOptions.spawn,
        (start) => {
          entry = admit(ownerKey, gate, policy, start);
        },
      );
    } catch (error) {
      if (treeLedger) {
        treeLedger.starts -= 1;
        treeLedger.active -= 1;
      }
      if (entry) {
        entry.settle();
      } else {
        gate.outstanding -= 1;
        maybeDeleteGate(ownerKey, gate);
      }
      throw error;
    }

    // Release the per-owner slot when the kernel execution settles, then start
    // the next queued entry FIFO.
    void handle.result().then(
      () => entry!.settle(),
      () => entry!.settle(),
    );

    const attached = attachExisting(handle, {
      targetId: agent.id,
      targetLabel: spawnOptions.targetLabel ?? agent.id,
      occurrence: spawnOptions.occurrence,
      input,
      topology: {
        rootId: parent ? parent.rootId : handle.id,
        ...(parent ? { parentWorkId: parent.handle.id } : {}),
        depth,
        policy,
      },
      releaseOwnerOutstanding: () => entry!.releaseOutstanding(),
    });

    // After acceptance, settle the tree once the kernel execution terminates.
    if (parent) {
      const rootId = parent.rootId;
      attachTreeSettlement(handle, () => settleDescendant(rootId));
    } else {
      ensureRootLedger(handle.id);
      attachTreeSettlement(handle, () => settleRootTerminal(handle.id));
    }

    return attached;
  }

  function attachExisting<TOutput>(
    handle: InternalWorkHandle<TOutput>,
    attachOptions: {
      readonly targetId: string;
      readonly targetLabel: string;
      readonly occurrence?: AgentToolOccurrenceKey;
      readonly input?: unknown;
      readonly topology?: AgentWorkTopology;
      readonly releaseOwnerOutstanding?: () => void;
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

    const topology = attachOptions.topology ?? {
      rootId: handle.id,
      depth: 0,
      policy: hostPolicy,
    };

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
      rootId: topology.rootId,
      ...(topology.parentWorkId ? { parentWorkId: topology.parentWorkId } : {}),
      depth: topology.depth,
      policy: topology.policy,
      ...(attachOptions.releaseOwnerOutstanding
        ? { releaseOwnerOutstanding: attachOptions.releaseOwnerOutstanding }
        : {}),
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

        if (record.parentWorkId) {
          const severed = handle.detachFromParent();
          if (severed) {
            record.releaseOwnerOutstanding?.();
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
          }

          // Cancellation or terminalization won the sever: report an
          // already-terminal receipt without changing ownership. A briefly
          // cancel-requested status settles once the execution rejects.
          const status = await handle.status();
          if (status.state === "cancel-requested") {
            await handle.result().catch(() => undefined);
          }
          return Object.freeze({
            workId: handle.id,
            outcome: "already-terminal",
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
        record.releaseOwnerOutstanding?.();
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
