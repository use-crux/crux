import { useMemo } from "react";
import { Icon } from "@/devtools/shell/Icon";
import type { WorkspaceDetail, WorkspaceFileSummary } from "@/types";

interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  children: Array<FolderNode | LeafNode>;
  depth: number;
  mountLabel?: string;
}

interface LeafNode {
  type: "file";
  file: WorkspaceFileSummary;
  depth: number;
}

function buildFileTree(files: readonly WorkspaceFileSummary[]): FolderNode {
  const root: FolderNode = {
    type: "folder",
    name: "",
    path: "",
    children: [],
    depth: -1,
  };
  const byPath = new Map<string, FolderNode>();
  byPath.set("", root);

  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let parent = root;
    let cursor = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      cursor = cursor ? `${cursor}/${seg}` : seg;
      let next = byPath.get(cursor);
      if (!next) {
        next = {
          type: "folder",
          name: `${seg}/`,
          path: cursor,
          children: [],
          depth: parent.depth + 1,
        };
        parent.children.push(next);
        byPath.set(cursor, next);
      }
      parent = next;
    }
    parent.children.push({ type: "file", file: f, depth: parent.depth + 1 });
  }

  return root;
}

export function FileTreePane({
  files,
  mounts,
  selectedPath,
  onSelect,
}: {
  files: readonly WorkspaceFileSummary[];
  mounts: WorkspaceDetail["mounts"];
  selectedPath: string | undefined;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  return (
    <aside
      className="flex h-full w-[280px] flex-shrink-0 flex-col overflow-y-auto"
      style={{
        borderRight: "1px solid var(--devtools-border)",
        background: "var(--devtools-bg)",
      }}
    >
      <div
        className="px-3 pb-2 pt-3 font-mono text-[10px] uppercase tracking-[0.14em]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        files · {files.length}
      </div>
      {files.length === 0 ? (
        <div
          className="px-4 py-3 text-[12px]"
          style={{ color: "var(--devtools-fg-muted)" }}
        >
          No files touched yet.
        </div>
      ) : (
        <div className="px-2 pb-4">
          {tree.children.map((n, i) => (
            <TreeNodeRow
              key={`${n.type}-${i}`}
              node={n}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
      {mounts && mounts.length > 0 && (
        <div
          className="mt-auto px-3 pb-3 pt-2 text-[10.5px]"
          style={{
            borderTop: "1px solid var(--devtools-border)",
            color: "var(--devtools-fg-faint)",
          }}
        >
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em]">
            mounts · {mounts.length}
          </div>
          {mounts.map((m) => (
            <div key={m.path} className="mb-1 font-mono last:mb-0">
              <div>
                <span style={{ color: "var(--devtools-crux)" }}>{m.path}</span>
                {m.mode && (
                  <span
                    className="ml-1.5"
                    style={{ color: "var(--devtools-fg-faint)" }}
                  >
                    ({m.mode})
                  </span>
                )}
              </div>
              {(m.sourceKind ||
                m.sourceHelper ||
                m.retriever ||
                m.sourceRef) && (
                <div
                  className="truncate"
                  style={{ color: "var(--devtools-fg-muted)" }}
                >
                  {[m.sourceKind, m.sourceHelper ?? m.retriever ?? m.sourceRef]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function TreeNodeRow({
  node,
  selectedPath,
  onSelect,
}: {
  node: FolderNode | LeafNode;
  selectedPath: string | undefined;
  onSelect: (p: string) => void;
}) {
  if (node.type === "folder") {
    return (
      <div>
        <div
          className="flex items-center gap-1.5 py-[3px] font-mono text-[11.5px] font-medium"
          style={{
            paddingLeft: 6 + node.depth * 14,
            color: "var(--devtools-fg)",
            marginTop: node.depth === 0 ? 6 : 0,
          }}
        >
          <Icon name="arrowDown" size={9} color="var(--devtools-fg-faint)" />
          <Icon name="folder" size={12} color="var(--devtools-crux)" />
          <span>{node.name}</span>
        </div>
        {node.children.map((c, i) => (
          <TreeNodeRow
            key={`${c.type}-${i}`}
            node={c}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  const f = node.file;
  const isErr = f.status === "err" || f.status === "denied";
  const on = selectedPath === f.path;
  return (
    <button
      type="button"
      onClick={() => onSelect(f.path)}
      className="grid w-full items-center gap-1.5 rounded-[6px] py-[4px] pr-2 text-left transition-colors"
      style={{
        gridTemplateColumns: "14px minmax(0, 1fr) auto",
        paddingLeft: 6 + node.depth * 14 + 14,
        background: on ? "var(--devtools-crux-soft)" : "transparent",
        boxShadow: on ? "inset 0 0 0 1px var(--devtools-crux-line)" : "none",
        borderLeft: isErr
          ? "2px solid var(--devtools-danger)"
          : "2px solid transparent",
        marginLeft: -2,
      }}
    >
      <Icon
        name="doc"
        size={11}
        color={
          isErr
            ? "var(--devtools-danger)"
            : on
              ? "var(--devtools-crux)"
              : "var(--devtools-fg-muted)"
        }
      />
      <span
        className="truncate font-mono text-[11.5px]"
        style={{
          color: isErr
            ? "var(--devtools-danger)"
            : on
              ? "var(--devtools-crux)"
              : "var(--devtools-fg)",
          fontWeight: on ? 600 : 450,
        }}
        title={f.path}
      >
        {f.path.split("/").pop()}
      </span>
      {f.operationCount != null && (
        <span
          className="font-mono text-[10px]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          {f.operationCount}
        </span>
      )}
    </button>
  );
}
