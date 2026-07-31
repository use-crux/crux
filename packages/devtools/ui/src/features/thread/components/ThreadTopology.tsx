/** Payload-safe, read-only Thread topology panel. */

import type { ReactNode } from "react";
import { Chip, Eyebrow, SectionHead } from "@/devtools/shell/primitives";
import type { ThreadInspection } from "@/types";

export function ThreadTopology({
  inspection,
}: {
  inspection: ThreadInspection;
}) {
  if (inspection.status !== "ok") {
    return <Unavailable inspection={inspection} />;
  }
  const topology = inspection.value;
  if (!topology || topology.state === "empty") {
    return <EmptyState threadId={topology?.threadId} />;
  }
  const rows = treeRows(topology.tree);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="plum" dot>
          {topology.state}
        </Chip>
        <span className="font-mono text-[12px] font-semibold">
          {topology.threadId}
        </span>
        <span className="text-[11px]" style={{ color: "var(--devtools-fg-faint)" }}>
          {topology.tree.length} nodes · {topology.groups.length} groups ·{" "}
          {topology.branches.length} branch points
        </span>
      </div>

      <Panel title="Owner heads">
        {Object.entries(topology.heads).length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {Object.entries(topology.heads).map(([owner, head]) => (
              <StructuralRow key={owner} label={owner} value={head} />
            ))}
          </div>
        ) : (
          <Quiet>No owner heads are published.</Quiet>
        )}
      </Panel>

      <Panel title="Conversation tree">
        <div className="flex flex-col gap-1">
          {rows.map(({ node, depth }) => (
            <div
              key={node.id}
              className="grid items-center gap-2 rounded-[6px] px-2.5 py-2"
              style={{
                gridTemplateColumns: "minmax(0, 1fr) auto auto",
                marginLeft: Math.min(depth, 8) * 18,
                background: "var(--devtools-bg-muted)",
                borderLeft: "2px solid var(--devtools-plum)",
              }}
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-[11.5px]">
                  {node.id}
                </div>
                <div
                  className="mt-0.5 truncate font-mono text-[9.5px]"
                  style={{ color: "var(--devtools-fg-faint)" }}
                >
                  parent {node.parentId ?? "root"} · group {node.groupId}
                </div>
              </div>
              {node.role && <Chip tone="muted">{node.role}</Chip>}
              <Chip tone={stateTone(node.state)}>{node.state}</Chip>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Causal groups">
        <div className="grid gap-2 md:grid-cols-2">
          {topology.groups.map((group) => (
            <div
              key={group.id}
              className="rounded-[8px] px-3 py-2.5"
              style={{
                background: "var(--devtools-bg-muted)",
                border: "1px solid var(--devtools-border)",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                  {group.id}
                </span>
                <Chip tone={stateTone(group.state)}>{group.state}</Chip>
              </div>
              <div className="mt-1.5 text-[10.5px]" style={{ color: "var(--devtools-fg-muted)" }}>
                {group.messageIds.length} message{group.messageIds.length === 1 ? "" : "s"}
                {group.selectedBy.length > 0
                  ? ` · selected by ${group.selectedBy.join(", ")}`
                  : " · alternative"}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Branch points">
        {topology.branches.length > 0 ? (
          <div className="flex flex-col gap-2">
            {topology.branches.map((branch) => (
              <div key={branch.parentId ?? "root"} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px]" style={{ color: "var(--devtools-fg-muted)" }}>
                  {branch.parentId ?? "root"}
                </span>
                <span style={{ color: "var(--devtools-fg-faint)" }}>→</span>
                {branch.groupIds.map((groupId) => (
                  <Chip key={groupId} tone="plum" mono>
                    {groupId}
                  </Chip>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <Quiet>No branch points in this Thread.</Quiet>
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <SectionHead eyebrow={title} />
      {children}
    </section>
  );
}

function StructuralRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 font-mono text-[11.5px]">
      <span style={{ color: "var(--devtools-fg-faint)" }}>{label}</span>
      <span className="break-all">{value}</span>
    </div>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <div className="text-[12px]" style={{ color: "var(--devtools-fg-muted)" }}>{children}</div>;
}

function EmptyState({ threadId }: { threadId?: string }) {
  return (
    <div className="rounded-[8px] border border-dashed border-(--devtools-border) px-5 py-8 text-center">
      <Eyebrow>Thread inspector</Eyebrow>
      <div className="mt-2 text-[12px]" style={{ color: "var(--devtools-fg-muted)" }}>
        {threadId ? `Thread ${threadId} has no published messages.` : "Thread topology is empty."}
      </div>
    </div>
  );
}

function Unavailable({ inspection }: { inspection: ThreadInspection }) {
  return (
    <div className="rounded-[8px] border border-dashed border-(--devtools-border) px-4 py-3 text-[12px]">
      <div className="font-medium">Live Thread topology unavailable</div>
      <div className="mt-1" style={{ color: "var(--devtools-fg-muted)" }}>
        {inspection.message ?? "Connect Runtime Bridge to inspect this Thread."}
      </div>
      {inspection.reason && (
        <div className="mt-2 font-mono text-[10px]" style={{ color: "var(--devtools-fg-faint)" }}>
          {inspection.reason}
        </div>
      )}
    </div>
  );
}

function treeRows(nodes: NonNullable<ThreadInspection["value"]>["tree"]) {
  type Node = (typeof nodes)[number];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, Node[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }

  const rows: { node: Node; depth: number }[] = [];
  const visited = new Set<string>();
  const visit = (node: Node, depth: number) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    rows.push({ node, depth });
    for (const child of children.get(node.id) ?? []) visit(child, depth + 1);
  };

  for (const node of nodes) {
    if (!node.parentId || !byId.has(node.parentId)) visit(node, 0);
  }
  for (const node of nodes) visit(node, 0);
  return rows;
}

function stateTone(state: string): "ok" | "warn" | "danger" | "muted" {
  if (state === "live") return "ok";
  if (state === "mixed") return "warn";
  if (state === "redacted") return "danger";
  return "muted";
}
