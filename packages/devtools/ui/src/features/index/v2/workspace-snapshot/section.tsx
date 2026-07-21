import type { ViewDef } from "../adapt";
import { useIndexIndex } from "../context";
import { Chip, SectionHead } from "../primitives";
import { T } from "../tokens";
import {
  workspaceSnapshotUsages,
  type WorkspaceSnapshotUsageEffect,
  type WorkspaceSnapshotUsageOperation,
} from "./usage";

const operationLabels = {
  "snapshot.create": "Create snapshot",
  "snapshot.list": "List snapshots",
  "snapshot.restore": "Restore snapshot",
  "snapshot.delete": "Delete snapshot",
} satisfies Record<WorkspaceSnapshotUsageOperation, string>;

const effectLabels = {
  "snapshot-access": "Non-live-tree access",
  "live-tree-mutation": "Live tree mutation",
  "snapshot-storage-mutation": "Snapshot storage mutation",
} satisfies Record<WorkspaceSnapshotUsageEffect, string>;

/** Renders authored snapshot facet usage for a Workspace Catalog definition. */
export function IndexWorkspaceSnapshotUsage({
  def,
}: {
  readonly def: ViewDef;
}) {
  const index = useIndexIndex();
  const usages = workspaceSnapshotUsages(index, def.id);
  if (def.kind !== "workspace" || usages.length === 0) return null;

  return (
    <section style={{ marginBottom: 22 }}>
      <SectionHead
        eyebrow="Authored snapshot usage"
        right={
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>
            {usages.length} operation{usages.length === 1 ? "" : "s"}
          </span>
        }
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 8,
        }}
      >
        {usages.map((usage) => (
          <article
            key={usage.relationId}
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${T.border}`,
              background: T.bgElev,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <strong style={{ fontSize: 12.5, color: T.fg }}>
                {operationLabels[usage.operation]}
              </strong>
              <Chip
                tone={
                  usage.effect === "live-tree-mutation"
                    ? "warn"
                    : usage.effect === "snapshot-storage-mutation"
                      ? "plum"
                      : "muted"
                }
                mono
              >
                {effectLabels[usage.effect]}
              </Chip>
            </div>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexWrap: "wrap",
                gap: "4px 10px",
                fontFamily: T.mono,
                fontSize: 10.5,
                color: T.fgMuted,
              }}
            >
              <span>{usage.ownerName ?? usage.ownerId}</span>
              {usage.source && (
                <span>
                  {usage.source.file}:{usage.source.line}
                </span>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
