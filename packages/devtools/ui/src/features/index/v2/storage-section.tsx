import type { ReactNode } from "react";
import { T, toneColor, type Tone } from "./tokens";
import { Chip, SectionHead } from "./primitives";
import { KindBadge, KindGlyph } from "./kit";
import type { ViewDef } from "./adapt";
import { useIndexIndex, useIndexSelect } from "./context";
import {
  storageSummaryForDef,
  type StorageReadModelSummary,
  type StorageWarningSeverity,
} from "./storage";

type DisplayValue = Exclude<ReactNode, null | undefined>;

interface Row {
  label: string;
  value: DisplayValue;
}

function labelValue(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (Array.isArray(value)) return value.length ? value.join(", ") : undefined;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: T.bgElev,
        border: `1px solid ${T.border}`,
        borderRadius: 9,
        padding: 14,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: T.mono,
          fontSize: 10,
          color: T.fgFaint,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function KeyValueList({ rows }: { rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: "grid",
            gridTemplateColumns: "96px minmax(0, 1fr)",
            gap: 10,
          }}
        >
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>
            {row.label}
          </span>
          <span
            style={{
              fontFamily: T.mono,
              fontSize: 11.5,
              color: T.fg,
              minWidth: 0,
              overflowWrap: "anywhere",
            }}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function capabilityRows(summary: StorageReadModelSummary): Row[] {
  const caps = summary.capabilities;
  if (!caps) return [];
  const rows: Row[] = [];
  const push = (group: string, key: string, value: unknown) => {
    const label = labelValue(value);
    if (label) rows.push({ label: `${group}.${key}`, value: label });
  };
  push("record", "ttl", caps.record?.ttl);
  push("record", "filter", caps.record?.filter);
  push("record", "watch", caps.record?.watch);
  push("record", "batch", caps.record?.batch);
  push("vector", "dense", caps.vector?.dense);
  push("vector", "sparse", caps.vector?.sparse);
  push("vector", "hybrid", caps.vector?.hybrid);
  push("vector", "fusion", caps.vector?.fusion);
  push("vector", "filter", caps.vector?.filter);
  push("vector", "consistency", caps.vector?.consistency);
  return rows;
}

function runtimeRows(summary: StorageReadModelSummary): Row[] {
  const runtime = summary.runtime;
  if (!runtime) return [];
  const rows: Array<{ label: string; value: ReactNode }> = [
    { label: "operations", value: runtime.operationCount },
    { label: "errors", value: runtime.errorCount },
    {
      label: "latency",
      value:
        runtime.avgLatencyMs == null ? undefined : `${runtime.avgLatencyMs}ms`,
    },
    { label: "results", value: runtime.resultCount },
    { label: "bytes", value: runtime.bytes },
  ];
  return rows.filter((row): row is Row => row.value != null);
}

function warningTone(severity: StorageWarningSeverity): Tone {
  return severity === "error"
    ? "danger"
    : severity === "warning"
      ? "warn"
      : "muted";
}

function ComponentLinks({ summary }: { summary: StorageReadModelSummary }) {
  const idx = useIndexIndex();
  const select = useIndexSelect();
  const entries = [
    ["record", summary.components.recordStoreId],
    ["vector", summary.components.vectorStoreId],
    ["asset", summary.components.assetStoreId],
    ["base", summary.components.storageId],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (!entries.length) return null;
  return (
    <Panel title="Components">
      <div style={{ display: "grid", gap: 7 }}>
        {entries.map(([label, id]) => {
          const target = idx.byId(id);
          return (
            <button
              key={label}
              type="button"
              onClick={target ? () => select(id) : undefined}
              style={{
                all: "unset",
                cursor: target ? "pointer" : "default",
                display: "grid",
                gridTemplateColumns: "22px 54px minmax(0, 1fr)",
                gap: 8,
                alignItems: "center",
                padding: "5px 0",
              }}
            >
              {target ? <KindGlyph kind={target.kind} size={22} /> : <span />}
              <span
                style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}
              >
                {label}
              </span>
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 11.5,
                  color: T.fg,
                  overflowWrap: "anywhere",
                }}
              >
                {id}
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function UsedBy({ summary }: { summary: StorageReadModelSummary }) {
  const idx = useIndexIndex();
  const select = useIndexSelect();
  if (!summary.usedBy.length) return null;
  return (
    <Panel title="Used by">
      <div style={{ display: "grid", gap: 7 }}>
        {summary.usedBy.map((use) => {
          const target = idx.byId(use.definitionId);
          return (
            <button
              key={`${use.relationType}:${use.definitionId}`}
              type="button"
              onClick={target ? () => select(use.definitionId) : undefined}
              style={{
                all: "unset",
                cursor: target ? "pointer" : "default",
                display: "grid",
                gridTemplateColumns: "22px minmax(0, 1fr) auto",
                gap: 8,
                alignItems: "center",
                padding: "5px 0",
              }}
            >
              {target ? <KindGlyph kind={target.kind} size={22} /> : <span />}
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 11.5,
                  color: T.fg,
                  overflowWrap: "anywhere",
                }}
              >
                {target?.name ?? use.name ?? use.definitionId}
              </span>
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 9.5,
                  color: T.fgFaint,
                  whiteSpace: "nowrap",
                }}
              >
                {use.relationType.replace(/_/g, " ")}
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function Warnings({ summary }: { summary: StorageReadModelSummary }) {
  if (!summary.warnings.length) return null;
  return (
    <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
      {summary.warnings.map((warning) => {
        const tone = warningTone(warning.severity);
        const c = toneColor(T, tone);
        return (
          <div
            key={`${warning.code}:${warning.message}`}
            style={{
              border: `1px solid ${c.line}`,
              background: c.soft,
              borderRadius: 9,
              padding: "10px 12px",
              display: "grid",
              gap: 5,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <Chip tone={tone} mono>
                {warning.code}
              </Chip>
              {warning.relatedDefinitionIds?.map((id) => (
                <span
                  key={id}
                  style={{
                    fontFamily: T.mono,
                    fontSize: 10.5,
                    color: T.fgMuted,
                  }}
                >
                  {id}
                </span>
              ))}
            </div>
            <div
              style={{
                fontFamily: T.serif,
                fontSize: 13,
                lineHeight: 1.5,
                color: T.fg,
              }}
            >
              {warning.message}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Detail-panel section for Storage Beta definitions. */
export function IndexStorage({ def }: { def: ViewDef }) {
  const summary = storageSummaryForDef(def);
  if (!summary) return null;
  const overviewRows: Array<{ label: string; value: ReactNode }> = [
    { label: "kind", value: <KindBadge kind={summary.kind} /> },
    { label: "backend", value: summary.backend },
    { label: "variable", value: summary.variableName },
    { label: "prefix", value: summary.prefix },
  ];
  const visibleOverviewRows = overviewRows.filter(
    (row): row is Row => row.value != null,
  );
  const caps = capabilityRows(summary);
  const runtime = runtimeRows(summary);

  return (
    <>
      <SectionHead
        eyebrow="Storage"
        right={
          summary.warnings.length ? (
            <Chip
              tone={
                summary.warnings.some((w) => w.severity === "error")
                  ? "danger"
                  : "warn"
              }
              dot
            >
              {summary.warnings.length} warning
              {summary.warnings.length === 1 ? "" : "s"}
            </Chip>
          ) : undefined
        }
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 12,
          marginBottom: 22,
        }}
      >
        <Panel title="Definition">
          <KeyValueList rows={visibleOverviewRows} />
        </Panel>
        <ComponentLinks summary={summary} />
        {caps.length ? (
          <Panel title="Capabilities">
            <KeyValueList rows={caps} />
          </Panel>
        ) : null}
        <UsedBy summary={summary} />
        {runtime.length ? (
          <Panel title="Runtime">
            <KeyValueList rows={runtime} />
          </Panel>
        ) : null}
        <Warnings summary={summary} />
      </div>
    </>
  );
}
