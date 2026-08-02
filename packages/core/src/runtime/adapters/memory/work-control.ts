import type {
  RuntimeWorkControlPort,
  WorkControlCommandKey,
  WorkControlRecord,
} from "../../ports/work-control";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";

export function createMemoryWorkControlPort(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
): RuntimeWorkControlPort {
  return {
    async get(key) {
      const record = data.workControl.get(workControlKey(key));
      return record ? cloneWorkControlRecord(record) : null;
    },
    async create(record) {
      const key = workControlKey(record);
      const existing = data.workControl.get(key);
      if (existing) return cloneWorkControlRecord(existing);

      recordWrite?.();
      const created = cloneWorkControlRecord(record);
      data.workControl.set(key, created);
      return cloneWorkControlRecord(created);
    },
  };
}

function workControlKey(key: WorkControlCommandKey): string {
  return scopedKey(key.namespace, `${key.workId}\0${key.commandId}`);
}

function cloneWorkControlRecord(record: WorkControlRecord): WorkControlRecord {
  return Object.freeze({
    namespace: record.namespace,
    workId: record.workId,
    commandId: record.commandId,
    payloadHash: record.payloadHash,
    acceptedAgentTargetId: record.acceptedAgentTargetId,
    resolvedPlanId: record.resolvedPlanId,
    revision: record.revision,
    outcome: record.outcome,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}
