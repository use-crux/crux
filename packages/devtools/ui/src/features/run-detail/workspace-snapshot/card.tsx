import type { ObservabilityRunDetailNode } from "@/types";
import { Chip } from "@/devtools/shell/primitives";
import {
  projectWorkspaceSnapshotRun,
  workspaceSnapshotRunSummary,
} from "./presentation";

/** Purpose-built run card for observed Workspace snapshot operations. */
export function WorkspaceSnapshotCard({
  node,
}: {
  readonly node: ObservabilityRunDetailNode;
}) {
  const presentation = projectWorkspaceSnapshotRun(node);
  if (!presentation) {
    return (
      <div className="text-[12px] text-[var(--devtools-fg-muted)]">
        Workspace snapshot details unavailable.
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border px-4 py-4"
      style={{
        borderColor: "var(--devtools-border)",
        background: "var(--devtools-bg-muted)",
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Chip tone={presentation.status === "failure" ? "danger" : "ok"} dot>
          {presentation.status === "failure" ? "Failed" : "Completed"}
        </Chip>
        <Chip tone="muted">Workspace snapshot</Chip>
      </div>
      <div className="text-[14px] font-medium text-[var(--devtools-fg)]">
        {workspaceSnapshotRunSummary(presentation)}
      </div>
    </div>
  );
}
