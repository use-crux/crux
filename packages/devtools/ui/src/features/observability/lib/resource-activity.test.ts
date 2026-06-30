import { describe, expect, it } from "vitest";
import type { ObservabilityResourceActivity, TaskUpdatedEvent } from "@/types";
import {
  taskEventsFromResourceActivity,
  workspaceEventsFromResourceActivity,
} from "./resource-activity";

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
});
