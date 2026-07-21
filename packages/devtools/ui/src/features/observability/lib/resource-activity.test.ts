import { describe, expect, it } from "vitest";
import type { ObservabilityResourceActivity, TaskUpdatedEvent } from "@/types";
import {
  taskEventsFromResourceActivity,
  workspaceEventsFromResourceActivity,
} from "./resource-activity";
import { summarizeEvent } from "@/features/run-detail/lib/span-detail-format";

function taskActivity(
  status: string,
  progress?: string,
): ObservabilityResourceActivity {
  return {
    spanId: `span-${status}`,
    runId: "run-tasks",
    traceId: "trace-tasks",
    family: "task",
    primitive: "task.operation",
    name: "task.update",
    status: "ok",
    startedAt: "2026-05-21T10:00:00.000Z",
    endedAt: "2026-05-21T10:00:00.010Z",
    durationMs: 10,
    resourceId: `task-${status}`,
    attributes: {
      operation: "update",
      taskListId: "list-1",
      taskId: `task-${status}`,
      status,
    },
    artifacts: [
      {
        artifactId: `artifact-${status}`,
        runId: "run-tasks",
        traceId: "trace-tasks",
        spanId: `span-${status}`,
        kind: "output",
        createdAt: "2026-05-21T10:00:00.010Z",
        contentType: "application/json",
        encoding: "json",
        sizeBytes: 0,
        hash: "",
        uri: "",
        preview: {
          primitive: "task.operation",
          operation: "update",
          taskListId: "list-1",
          taskId: `task-${status}`,
          status,
          progress,
        },
      },
    ],
  };
}

describe("taskEventsFromResourceActivity", () => {
  it("preserves canonical task statuses and progress messages", () => {
    const { taskEvents } = taskEventsFromResourceActivity([
      taskActivity("completed"),
      taskActivity("failed", "Errored while drafting"),
      taskActivity("skipped"),
      taskActivity("cancelled"),
    ]);

    const updates = taskEvents.filter(
      (event): event is TaskUpdatedEvent & { _kind: "updated" } =>
        event.type === "task:updated",
    );

    expect(updates.map((event) => event.status)).toEqual([
      "completed",
      "failed",
      "skipped",
      "cancelled",
    ]);
    expect(updates.find((event) => event.status === "failed")?.progress).toBe(
      "Errored while drafting",
    );
  });
});

describe("workspaceEventsFromResourceActivity", () => {
  it("uses path hashes as stable labels and preserves artifact metadata", () => {
    const events = workspaceEventsFromResourceActivity([
      {
        spanId: "span-finalize",
        runId: "run-workspace",
        traceId: "trace-workspace",
        family: "workspace",
        primitive: "workspace.operation",
        name: "workspace.finalize",
        status: "ok",
        startedAt: "2026-06-30T10:00:00.000Z",
        endedAt: "2026-06-30T10:00:00.010Z",
        durationMs: 10,
        resourceId: "drafts",
        attributes: {
          workspaceId: "drafts",
          operation: "finalize",
          pathHash: "fnv1a:abc123",
          path: "/outputs/report.pdf",
          namespaceHash: "ns1",
          status: "success",
          artifactStatus: "final",
          artifactKind: "report",
        },
        artifacts: [
          {
            artifactId: "artifact-report",
            runId: "run-workspace",
            traceId: "trace-workspace",
            spanId: "span-finalize",
            kind: "output",
            createdAt: "2026-06-30T10:00:00.010Z",
            contentType: "application/json",
            encoding: "json",
            sizeBytes: 9001,
            hash: "",
            uri: "workspace-inline://drafts/ns1/outputs/report.pdf",
            preview: { contentStored: false },
            attributes: {
              mimeType: "application/pdf",
              artifactStatus: "final",
              uri: "workspace-inline://drafts/ns1/outputs/report.pdf",
            },
          },
        ],
      },
    ]);

    expect(events[0]).toEqual(
      expect.objectContaining({
        path: "hash:fnv1a:abc123",
        pathHash: "fnv1a:abc123",
        mimeType: "application/pdf",
        size: 9001,
        artifactStatus: "final",
        artifactKind: "report",
        uri: "workspace-inline://drafts/ns1/outputs/report.pdf",
      }),
    );
  });

  it("projects snapshot aggregates and privacy-safe summaries", () => {
    const activities = [
      snapshotActivity("snapshot.create", { fileCount: 2, sizeBytes: 64 }),
      snapshotActivity("snapshot.list", { snapshotCount: 3 }),
      snapshotActivity("snapshot.restore", {
        restoredFiles: 4,
        deletedFiles: 1,
        unchangedFiles: 2,
      }),
      snapshotActivity("snapshot.delete", {}),
      snapshotActivity("snapshot.restore", {}, true),
    ];
    const events = workspaceEventsFromResourceActivity(activities);

    expect(events).toEqual([
      expect.objectContaining({
        operation: "snapshot.create",
        path: "",
        pathHash: "fnv1a:safe",
        fileCount: 2,
        sizeBytes: 64,
      }),
      expect.objectContaining({
        operation: "snapshot.list",
        snapshotCount: 3,
      }),
      expect.objectContaining({
        operation: "snapshot.restore",
        restoredFiles: 4,
        deletedFiles: 1,
        unchangedFiles: 2,
      }),
      expect.objectContaining({ operation: "snapshot.delete" }),
      expect.objectContaining({
        operation: "snapshot.restore",
        status: "error",
        errorCode: "corrupt_snapshot",
      }),
    ]);
    expect(events[0].size).toBeUndefined();

    const summaries = events.map((event, index) =>
      summarizeEvent({
        id: String(index),
        eventType: "workspace:operation",
        timestamp: event.timestamp,
        data: { ...event },
      }),
    );
    expect(summaries).toEqual([
      "Created snapshot — 2 files, 64 bytes",
      "Listed snapshots — 3 snapshots",
      "Restored snapshot — 4 restored, 1 deleted, 2 unchanged",
      "Deleted snapshot",
      "Failure — corrupt_snapshot",
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /private-path|snapshot-id-private|asset:\/\/private/,
    );
  });
});

function snapshotActivity(
  operation: string,
  aggregates: Record<string, number>,
  failed = false,
): ObservabilityResourceActivity {
  return {
    spanId: `span-${operation}`,
    runId: "run-snapshot",
    traceId: "trace-snapshot",
    family: "workspace",
    primitive: "workspace.operation",
    name: `workspace.${operation}`,
    status: failed ? "error" : "ok",
    startedAt: "2026-07-21T12:00:00.000Z",
    endedAt: "2026-07-21T12:00:00.010Z",
    durationMs: 10,
    resourceId: "drafts",
    attributes: {
      workspaceId: "drafts",
      namespaceHash: "namespace-safe",
      operation,
      pathHash: "fnv1a:safe",
      path: "/private-path",
      ...aggregates,
    },
    error: failed
      ? {
          name: "WorkspaceSnapshotError",
          category: "corrupt_snapshot",
          message: "snapshot-id-private asset://private /private-path",
        }
      : undefined,
  };
}
