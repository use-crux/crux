import { useMemo, useState } from "react";
import { Btn, Chip, SectionHead } from "@/qw/shell/primitives";
import { Icon } from "@/qw/shell/Icon";
import { useWorkspaceFile } from "@/shared/hooks/useLibraryApi";
import {
  fmtBytes,
  fmtDuration,
  fmtRelative,
  fmtTime,
  shortPath,
  shortTrace,
  statusTone,
} from "@/features/workspaces/lib/workspace-format";
import {
  EmptyHint,
  ErrorBanner,
  OpPill,
  PendingBackend,
  TableHeader,
} from "@/features/workspaces/components/WorkspaceAtoms";
import type { WorkspaceFileSummary, WorkspaceOpRecord } from "@/types";

type InspectorTab = "preview" | "operations" | "versions";

export function FileInspector({
  workspaceId,
  filePath,
  files,
  ops,
}: {
  workspaceId: string;
  filePath: string;
  files: readonly WorkspaceFileSummary[];
  ops: readonly WorkspaceOpRecord[];
}) {
  const summary = files.find((f) => f.path === filePath);
  const {
    data: detail,
    loading,
    error,
  } = useWorkspaceFile(workspaceId, filePath);
  const fileOps = useMemo(
    () => ops.filter((o) => o.path === filePath),
    [ops, filePath],
  );
  const [tab, setTab] = useState<InspectorTab>("preview");

  const versions = detail?.versions ?? [];
  const detailOps = detail?.operations ?? [];
  const combinedOps = detailOps.length > 0 ? detailOps : fileOps;

  const isErr = summary?.status === "err" || summary?.status === "denied";

  return (
    <div className="flex min-w-0 flex-1 flex-col px-8 py-6">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <Icon
          name="doc"
          size={16}
          color={isErr ? "var(--qw-danger)" : "var(--qw-crux)"}
          className="shrink-0"
        />
        <span
          className="min-w-0 truncate font-mono text-[18px] font-semibold"
          title={filePath}
        >
          {shortPath(filePath, 80)}
        </span>
        {summary?.mime && (
          <Chip tone="muted" mono>
            {summary.mime}
          </Chip>
        )}
        {summary?.size != null && (
          <Chip tone="muted" mono>
            {fmtBytes(summary.size)}
          </Chip>
        )}
        {summary?.status && (
          <Chip tone={statusTone(summary.status)} dot>
            {summary.status}
          </Chip>
        )}
        {summary?.artifactStatus && (
          <Chip tone="muted" mono>
            {summary.artifactStatus}
          </Chip>
        )}
        {summary?.artifactKind && (
          <Chip tone="muted" mono>
            {summary.artifactKind}
          </Chip>
        )}
        {summary?.uri && (
          <Chip tone="muted" mono>
            ref
          </Chip>
        )}
        <div className="ml-auto flex shrink-0 gap-1.5">
          <Btn
            size="xs"
            icon={<Icon name="diff" size={10} />}
            disabled
            title="Versions — pending backend projection"
          >
            Versions
          </Btn>
          <Btn
            size="xs"
            icon={<Icon name="link" size={10} />}
            disabled
            title="Open file deep link — backend wiring not yet shipped"
          >
            Open file
          </Btn>
        </div>
      </div>

      <div
        className="mb-4 inline-flex w-fit overflow-hidden rounded-[6px]"
        style={{
          background: "var(--qw-bg)",
          border: "1px solid var(--qw-border)",
          padding: 2,
        }}
      >
        {(["preview", "operations", "versions"] as const).map((id) => {
          const on = tab === id;
          const count =
            id === "operations"
              ? combinedOps.length
              : id === "versions"
                ? versions.length
                : null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-3 py-1 text-[12px] transition-colors"
              style={{
                background: on ? "var(--qw-bg-elev)" : "transparent",
                color: on ? "var(--qw-fg)" : "var(--qw-fg-muted)",
                fontWeight: on ? 600 : 450,
                boxShadow: on ? "inset 0 0 0 1px var(--qw-border)" : "none",
                borderRadius: 4,
              }}
            >
              {id}
              {count != null && (
                <span
                  className="font-mono text-[10px]"
                  style={{
                    color: on ? "var(--qw-crux)" : "var(--qw-fg-faint)",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <ErrorBanner message={`Couldn't load file: ${error.message}`} />
      )}

      {tab === "preview" && (
        <PreviewBlock
          filePath={filePath}
          detail={detail}
          loading={loading && !detail}
          summary={summary}
        />
      )}
      {tab === "operations" && <FileOperationsTable ops={combinedOps} />}
      {tab === "versions" && <FileVersionsTable versions={versions} />}
    </div>
  );
}

function PreviewBlock({
  filePath,
  detail,
  loading,
  summary,
}: {
  filePath: string;
  detail: ReturnType<typeof useWorkspaceFile>["data"] | undefined;
  loading: boolean;
  summary: WorkspaceFileSummary | undefined;
}) {
  const preview = detail?.preview;
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{
        background: "var(--qw-bg-elev)",
        border: "1px solid var(--qw-border)",
      }}
    >
      <div
        className="flex items-center gap-2 px-3.5 py-2 font-mono text-[11px]"
        style={{
          borderBottom: "1px solid var(--qw-border)",
          background: "var(--qw-bg-muted)",
          color: "var(--qw-fg-muted)",
        }}
      >
        <Icon name="doc" size={11} />
        <span>{filePath}</span>
        {summary?.lastOpAt && (
          <span style={{ color: "var(--qw-fg-faint)" }}>
            · last touched {fmtRelative(summary.lastOpAt)}
          </span>
        )}
        <span className="ml-auto" style={{ color: "var(--qw-fg-faint)" }}>
          {preview?.contentType ?? summary?.mime ?? "—"}
        </span>
      </div>
      {loading ? (
        <div
          className="px-4 py-6 text-center text-[12px]"
          style={{ color: "var(--qw-fg-muted)" }}
        >
          Loading preview…
        </div>
      ) : preview?.body ? (
        <>
          <pre
            className="m-0 overflow-x-auto px-4 py-3 text-[11.5px] leading-[1.55]"
            style={{
              fontFamily: "var(--qw-font-mono, ui-monospace)",
              color: "var(--qw-fg)",
              maxHeight: "500px",
            }}
          >
            {preview.body}
          </pre>
          {preview.truncated && (
            <div
              className="px-4 py-2 text-[10.5px]"
              style={{
                background: "var(--qw-bg-muted)",
                color: "var(--qw-fg-muted)",
                borderTop: "1px solid var(--qw-border)",
              }}
            >
              Preview truncated by backend.
            </div>
          )}
        </>
      ) : (
        <PendingBackend
          title="Preview not captured"
          body="The backend hasn't shipped file preview bodies for this workspace yet."
        />
      )}
    </div>
  );
}

function FileOperationsTable({ ops }: { ops: readonly WorkspaceOpRecord[] }) {
  if (ops.length === 0) {
    return <EmptyHint>No operations recorded for this file yet.</EmptyHint>;
  }
  const hasDur = ops.some((o) => o.durationMs != null);
  const hasActor = ops.some((o) => o.actor);
  const hasSpan = ops.some((o) => o.spanId);
  const hasBytes = ops.some((o) => o.bytes != null);
  const hasTrace = ops.some((o) => o.traceId);
  const hasArtifact = ops.some(
    (o) => o.artifactStatus || o.artifactKind || o.uri,
  );
  return (
    <section>
      <SectionHead
        eyebrow="Operations on this file"
        right={
          <span
            className="font-mono text-[11px]"
            style={{ color: "var(--qw-fg-faint)" }}
          >
            {ops.length} · chronological
          </span>
        }
      />
      <div
        className="overflow-hidden rounded-[10px]"
        style={{
          background: "var(--qw-bg-elev)",
          border: "1px solid var(--qw-border)",
        }}
      >
        <TableHeader
          cols={[
            { label: "time", width: "70px" },
            { label: "op", width: "70px" },
            ...(hasDur
              ? [{ label: "dur", width: "70px", align: "right" as const }]
              : []),
            ...(hasActor ? [{ label: "actor", width: "120px" }] : []),
            ...(hasSpan ? [{ label: "span", width: "minmax(0, 1fr)" }] : []),
            ...(hasArtifact ? [{ label: "artifact", width: "150px" }] : []),
            ...(hasBytes
              ? [{ label: "bytes", width: "70px", align: "right" as const }]
              : []),
            ...(hasTrace
              ? [{ label: "trace", width: "70px", align: "right" as const }]
              : []),
          ]}
        />
        {ops.map((o, i) => (
          <div
            key={o.eventId}
            className="grid items-center gap-2.5 px-4 py-2 font-mono text-[11.5px]"
            style={{
              gridTemplateColumns: [
                "70px",
                "70px",
                hasDur ? "70px" : "",
                hasActor ? "120px" : "",
                hasSpan ? "minmax(0, 1fr)" : "",
                hasArtifact ? "150px" : "",
                hasBytes ? "70px" : "",
                hasTrace ? "70px" : "",
              ]
                .filter(Boolean)
                .join(" "),
              borderBottom:
                i === ops.length - 1 ? "none" : "1px solid var(--qw-border)",
            }}
          >
            <span style={{ color: "var(--qw-fg-faint)" }}>
              {fmtTime(o.timestamp)}
            </span>
            <OpPill op={o.op} />
            {hasDur && (
              <span
                className="text-right"
                style={{ color: "var(--qw-fg-faint)" }}
              >
                {fmtDuration(o.durationMs) ?? "—"}
              </span>
            )}
            {hasActor && (
              <span style={{ color: "var(--qw-fg)" }}>{o.actor ?? "—"}</span>
            )}
            {hasSpan && (
              <span
                className="truncate text-[10.5px]"
                style={{ color: "var(--qw-fg-muted)" }}
                title={o.spanId ?? undefined}
              >
                {o.spanId ?? "—"}
              </span>
            )}
            {hasArtifact && (
              <span
                className="truncate"
                style={{ color: "var(--qw-fg-muted)" }}
                title={o.uri}
              >
                {[o.artifactStatus, o.artifactKind]
                  .filter(Boolean)
                  .join(" · ") || (o.uri ? "ref" : "—")}
              </span>
            )}
            {hasBytes && (
              <span
                className="text-right"
                style={{ color: "var(--qw-fg-muted)" }}
              >
                {fmtBytes(o.bytes) ?? "—"}
              </span>
            )}
            {hasTrace && (
              <span className="text-right" style={{ color: "var(--qw-crux)" }}>
                {shortTrace(o.traceId) ?? "—"}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function FileVersionsTable({
  versions,
}: {
  versions: readonly {
    versionId: string;
    timestamp: number;
    actor?: string;
    diff?: { added: number; removed: number };
    traceId?: string;
  }[];
}) {
  if (versions.length === 0) {
    return (
      <PendingBackend
        title="Versions not captured"
        body="The backend hasn't shipped version history for this file yet."
      />
    );
  }
  return (
    <section>
      <SectionHead eyebrow={`Versions · ${versions.length}`} />
      <div
        className="overflow-hidden rounded-[10px]"
        style={{
          background: "var(--qw-bg-elev)",
          border: "1px solid var(--qw-border)",
        }}
      >
        <TableHeader
          cols={[
            { label: "version", width: "140px" },
            { label: "when", width: "120px" },
            { label: "actor", width: "120px" },
            { label: "diff", width: "minmax(0, 1fr)", align: "right" },
            { label: "trace", width: "80px", align: "right" },
          ]}
        />
        {versions.map((v, i) => (
          <div
            key={v.versionId}
            className="grid items-center gap-2.5 px-4 py-2 font-mono text-[11.5px]"
            style={{
              gridTemplateColumns: "140px 120px 120px minmax(0, 1fr) 80px",
              borderBottom:
                i === versions.length - 1
                  ? "none"
                  : "1px solid var(--qw-border)",
            }}
          >
            <span style={{ color: "var(--qw-fg)" }}>{v.versionId}</span>
            <span style={{ color: "var(--qw-fg-muted)" }}>
              {fmtRelative(v.timestamp) ?? "—"}
            </span>
            <span style={{ color: "var(--qw-fg)" }}>{v.actor ?? "—"}</span>
            <span className="text-right">
              {v.diff ? (
                <>
                  <span style={{ color: "var(--qw-ok)" }}>+{v.diff.added}</span>
                  {" / "}
                  <span style={{ color: "var(--qw-danger)" }}>
                    -{v.diff.removed}
                  </span>
                </>
              ) : (
                <span style={{ color: "var(--qw-fg-faint)" }}>—</span>
              )}
            </span>
            <span className="text-right" style={{ color: "var(--qw-crux)" }}>
              {shortTrace(v.traceId) ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
