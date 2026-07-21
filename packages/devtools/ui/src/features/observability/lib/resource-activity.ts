import type {
  MemoryEventData,
  MemoryWriteEvent,
  ObservabilityResourceActivity,
  PlanEventData,
  TaskAddedEvent,
  TaskEventData,
  TaskListEventData,
  WorkspaceOperationEvent,
} from "@/types";
import { workspaceSnapshotEventFromResourceActivity } from "./workspace-snapshot-activity";
import { workspaceSnapshotOperation } from "@/features/workspace-snapshot/contract";

function attrs(
  activity: ObservabilityResourceActivity,
): Record<string, unknown> {
  return activity.attributes ?? {};
}

function artifactPreview(activity: ObservabilityResourceActivity): unknown {
  return activity.artifacts?.[0]?.preview;
}

function artifactAttrs(
  activity: ObservabilityResourceActivity,
): Record<string, unknown> {
  return activity.artifacts?.[0]?.attributes ?? {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function timeMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function status(activity: ObservabilityResourceActivity): "success" | "error" {
  return activity.status === "error" || activity.error ? "error" : "success";
}

function operationFromName(activity: ObservabilityResourceActivity): string {
  const raw = stringValue(attrs(activity).operation);
  if (raw) return raw;
  const [, suffix] = activity.name.split(".", 2);
  return suffix || activity.name;
}

export function memoryEventsFromResourceActivity(
  activity: ObservabilityResourceActivity[],
): MemoryEventData[] {
  return activity
    .filter((item) => item.family === "memory")
    .map((item): MemoryEventData => {
      const a = attrs(item);
      const kind = item.primitive === "memory.read" ? "read" : "write";
      const base = {
        memoryId: stringValue(a.memoryId) ?? item.resourceId ?? "standalone",
        operation: operationFromName(item),
        traceId: item.traceId || undefined,
        memoryType:
          (stringValue(a.memoryType) as MemoryEventData["memoryType"]) ??
          "block",
        blockId: stringValue(a.blockId),
        blockKind: stringValue(a.blockKind) as MemoryEventData["blockKind"],
        namespaceHash: stringValue(a.namespaceHash),
        snapshot: artifactPreview(item),
        timestamp: timeMs(item.startedAt),
      };
      if (kind === "read") {
        return {
          ...base,
          type: "memory:read",
          _kind: "read",
          query: stringValue(a.query),
          resultCount: numberValue(a.resultCount) ?? numberValue(a.count) ?? 0,
          durationMs: item.durationMs,
        };
      }
      return {
        ...base,
        type: "memory:write",
        _kind: "write",
        entryKey: stringValue(a.entryKey) ?? stringValue(a.key),
        content: stringValue(a.contentPreview) ?? stringValue(a.content),
        writeMode: stringValue(a.writeMode) as MemoryWriteEvent["writeMode"],
        proposalStatus: stringValue(
          a.proposalStatus,
        ) as MemoryWriteEvent["proposalStatus"],
      };
    });
}

export function workspaceEventsFromResourceActivity(
  activity: ObservabilityResourceActivity[],
): WorkspaceOperationEvent[] {
  return activity
    .filter((item) => item.family === "workspace")
    .map((item): WorkspaceOperationEvent => {
      const a = attrs(item);
      const artifact = item.artifacts?.[0];
      const aa = artifactAttrs(item);
      const operation = operationFromName(
        item,
      ) as WorkspaceOperationEvent["operation"];
      const pathHash = stringValue(a.pathHash) ?? stringValue(aa.pathHash);
      const snapshotOperation = workspaceSnapshotOperation(operation);
      if (snapshotOperation) {
        return workspaceSnapshotEventFromResourceActivity({
          activity: item,
          operation: snapshotOperation,
          attributes: a,
          pathHash,
        });
      }
      return {
        type: "workspace:operation",
        workspaceId:
          stringValue(a.workspaceId) ?? item.resourceId ?? "workspace",
        namespace: stringValue(a.namespaceHash) ?? "",
        operation,
        path: pathHash ? `hash:${pathHash}` : (stringValue(a.path) ?? "/"),
        pathHash,
        status: status(item),
        durationMs: item.durationMs,
        mount: stringValue(a.mount),
        mimeType:
          stringValue(a.mimeType) ??
          stringValue(aa.mimeType) ??
          stringValue(artifact?.contentType),
        size:
          numberValue(a.size) ??
          numberValue(a.sizeBytes) ??
          numberValue(aa.size) ??
          numberValue(aa.sizeBytes) ??
          artifact?.sizeBytes,
        artifactStatus:
          stringValue(a.artifactStatus) ?? stringValue(aa.artifactStatus),
        artifactKind:
          stringValue(a.artifactKind) ?? stringValue(aa.artifactKind),
        uri:
          stringValue(a.uri) ??
          stringValue(aa.uri) ??
          stringValue(artifact?.uri),
        error: stringValue(item.error?.message),
        traceId: item.traceId || undefined,
        timestamp: timeMs(item.startedAt),
      };
    });
}

export function planEventsFromResourceActivity(
  activity: ObservabilityResourceActivity[],
): PlanEventData[] {
  return activity
    .filter((item) => item.family === "plan")
    .map((item): PlanEventData => {
      const a = attrs(item);
      const preview = artifactPreview(item);
      const p =
        typeof preview === "object" && preview !== null
          ? (preview as Record<string, unknown>)
          : {};
      const operation = operationFromName(item);
      const planId =
        stringValue(a.planId) ?? stringValue(p.planId) ?? item.resourceId;
      if (operation === "update") {
        return {
          type: "plan:updated",
          _kind: "updated",
          planId,
          version: numberValue(a.version) ?? numberValue(p.version) ?? 1,
          changes: stringList(a.changes).filter(
            (change): change is "title" | "content" | "status" | "metadata" =>
              ["title", "content", "status", "metadata"].includes(change),
          ),
          timestamp: timeMs(item.startedAt),
        };
      }
      return {
        type: "plan:created",
        _kind: "created",
        planId,
        title: stringValue(a.title) ?? stringValue(p.title) ?? "Untitled plan",
        contentPreview: stringValue(p.contentPreview) ?? "",
        status: stringValue(a.status) ?? "draft",
        timestamp: timeMs(item.startedAt),
      };
    });
}

export function taskEventsFromResourceActivity(
  activity: ObservabilityResourceActivity[],
): {
  taskListEvents: TaskListEventData[];
  taskEvents: TaskEventData[];
} {
  const taskListEvents: TaskListEventData[] = [];
  const taskEvents: TaskEventData[] = [];

  for (const item of activity.filter((entry) => entry.family === "task")) {
    const a = attrs(item);
    const preview = artifactPreview(item);
    const p =
      typeof preview === "object" && preview !== null
        ? (preview as Record<string, unknown>)
        : {};
    const operation = operationFromName(item);
    const timestamp = timeMs(item.startedAt);
    const taskListId =
      stringValue(a.taskListId) ?? stringValue(p.taskListId) ?? item.resourceId;

    if (operation === "tasklist.create") {
      taskListEvents.push({
        type: "tasklist:created",
        _kind: "created",
        taskListId,
        planId: stringValue(a.planId) ?? stringValue(p.planId),
        timestamp,
      });
    } else if (operation === "tasklist.discard") {
      taskListEvents.push({
        type: "tasklist:discarded",
        _kind: "discarded",
        taskListId,
        completedCount:
          numberValue(
            (p.counts as Record<string, unknown> | undefined)?.completed,
          ) ?? 0,
        remainingCount:
          numberValue(
            (p.counts as Record<string, unknown> | undefined)?.remaining,
          ) ?? 0,
        timestamp,
      });
    } else if (operation === "add") {
      taskEvents.push({
        type: "task:added",
        _kind: "added",
        taskListId,
        taskId:
          stringValue(a.taskId) ?? stringValue(p.taskId) ?? item.resourceId,
        label: stringValue(p.label) ?? stringValue(a.label) ?? "Untitled task",
        assignee: p.assignee as TaskAddedEvent["assignee"],
        timestamp,
      });
    } else if (operation === "update") {
      taskEvents.push({
        type: "task:updated",
        _kind: "updated",
        taskListId,
        taskId:
          stringValue(a.taskId) ?? stringValue(p.taskId) ?? item.resourceId,
        status: stringValue(a.status) ?? stringValue(p.status) ?? "pending",
        progress: stringValue(p.progress),
        durationMs: item.durationMs,
        timestamp,
      });
    } else if (operation === "remove") {
      taskEvents.push({
        type: "task:removed",
        _kind: "removed",
        taskListId,
        taskId:
          stringValue(a.taskId) ?? stringValue(p.taskId) ?? item.resourceId,
        timestamp,
      });
    }
  }

  return { taskListEvents, taskEvents };
}
