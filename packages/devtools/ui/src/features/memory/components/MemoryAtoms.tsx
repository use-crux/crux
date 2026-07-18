import { Icon } from "@/devtools/shell/Icon";
import type { IconName } from "@/devtools/shell/nav";
import { cruxDocsUrl } from "@/shared/lib/cruxDocs";
import type { MemoryInspection } from "@/types";

function opPillTone(op: string | undefined): { bg: string; fg: string } {
  switch (op) {
    case "write":
    case "delete":
      return { bg: "var(--devtools-danger-soft)", fg: "var(--devtools-danger)" };
    case "update":
      return { bg: "var(--devtools-warn-soft)", fg: "var(--devtools-warn)" };
    case "evict":
      // Retention GC sweep — eviction-style, visible but not alarming.
      return { bg: "var(--devtools-warn-soft)", fg: "var(--devtools-warn)" };
    case "append":
    case "record":
      return { bg: "var(--devtools-iris-soft)", fg: "var(--devtools-iris)" };
    case "read":
      return { bg: "var(--devtools-ok-soft)", fg: "var(--devtools-ok)" };
    case "query":
      return { bg: "var(--devtools-crux-soft)", fg: "var(--devtools-crux)" };
    default:
      return { bg: "var(--devtools-bg-muted)", fg: "var(--devtools-fg-muted)" };
  }
}

interface HeaderStripStat {
  label: string;
  value: React.ReactNode;
  color?: string;
}

export function LDHeaderStrip({
  icon,
  color,
  id,
  chips,
  stats,
  right,
}: {
  icon: IconName;
  color: string;
  id: string;
  chips?: React.ReactNode;
  stats: readonly HeaderStripStat[];
  right?: React.ReactNode;
}) {
  return (
    <div
      className="mb-5 grid items-center gap-4 rounded-[10px] px-4 py-3.5"
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px solid var(--devtools-border)",
        borderLeft: `3px solid ${color}`,
        gridTemplateColumns: "minmax(0, 1fr) auto",
      }}
    >
      <div className="min-w-0">
        <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-2">
          <Icon name={icon} size={15} color={color} className="shrink-0" />
          <span
            className="min-w-0 max-w-full truncate font-mono text-[17px] font-semibold"
            title={id}
          >
            {id}
          </span>
          {chips}
        </div>
        <div className="flex flex-wrap gap-6">
          {stats.map((stat) => (
            <div key={stat.label}>
              <div
                className="font-mono text-[10px] uppercase tracking-[0.1em]"
                style={{ color: "var(--devtools-fg-faint)" }}
              >
                {stat.label}
              </div>
              <div
                className="mt-0.5 font-mono text-[14px] font-semibold"
                style={{ color: stat.color ?? "var(--devtools-fg)" }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>
      {right && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {right}
        </div>
      )}
    </div>
  );
}

export function LDCard({
  title,
  right,
  color,
  children,
  padding,
}: {
  title: string;
  right?: React.ReactNode;
  color?: string;
  children: React.ReactNode;
  padding?: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px solid var(--devtools-border)",
      }}
    >
      <div
        className="flex items-center gap-2 px-3.5 py-2.5"
        style={{
          borderBottom: "1px solid var(--devtools-border)",
          background: "var(--devtools-bg-muted)",
        }}
      >
        {color && (
          <span
            className="size-[7px] rounded-full"
            style={{ background: color }}
          />
        )}
        <span className="text-[12px] font-semibold">{title}</span>
        {right && (
          <span className="ml-auto flex items-center gap-1.5">{right}</span>
        )}
      </div>
      <div style={{ padding: padding ?? 0 }}>{children}</div>
    </div>
  );
}

export function LDKV({
  k,
  type,
  v,
  color,
  last = false,
}: {
  k: string;
  type?: string;
  v: React.ReactNode;
  color?: string;
  last?: boolean;
}) {
  return (
    <div
      className="grid items-baseline gap-3 px-3.5 py-2 text-[12px]"
      style={{
        gridTemplateColumns: "180px 80px minmax(0, 1fr)",
        borderBottom: last ? "none" : "1px solid var(--devtools-border)",
      }}
    >
      <span
        className="font-mono font-medium"
        style={{ color: "var(--devtools-crux)" }}
      >
        {k}
      </span>
      <span
        className="font-mono text-[10.5px] tracking-[0.06em] lowercase"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        {type ?? "-"}
      </span>
      <span
        className="truncate font-mono"
        style={{ color: color ?? "var(--devtools-fg)" }}
        title={typeof v === "string" ? v : undefined}
      >
        {v}
      </span>
    </div>
  );
}

export function LDOpPill({ op }: { op: string }) {
  const tone = opPillTone(op);
  return (
    <span
      className="inline-flex w-fit rounded-[3px] px-1.5 py-[1px] font-mono text-[10.5px] font-semibold"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {op}
    </span>
  );
}

export function TableHeader({
  cols,
}: {
  cols: readonly { label: string; width: string; align?: "left" | "right" }[];
}) {
  return (
    <div
      className="grid gap-2.5 px-4 py-2 text-[10px] uppercase tracking-[0.1em]"
      style={{
        gridTemplateColumns: cols.map((c) => c.width).join(" "),
        color: "var(--devtools-fg-faint)",
        borderBottom: "1px solid var(--devtools-border)",
        background: "var(--devtools-bg-muted)",
      }}
    >
      {cols.map((c) => (
        <div key={c.label} style={{ textAlign: c.align ?? "left" }}>
          {c.label}
        </div>
      ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string | null | undefined;
  color?: string;
}) {
  return (
    <div className="flex flex-col">
      <span
        className="text-[10px] uppercase tracking-[0.08em]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        {label}
      </span>
      <span
        className="font-mono text-[14px] font-semibold"
        style={{
          color:
            color ??
            (value == null || value === "—"
              ? "var(--devtools-fg-faint)"
              : "var(--devtools-fg)"),
        }}
      >
        {value == null ? "—" : value}
      </span>
    </div>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[10px] px-6 py-10 text-center text-[13px]"
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px dashed var(--devtools-border)",
        color: "var(--devtools-fg-muted)",
      }}
    >
      {children}
    </div>
  );
}

export function EmptyInline({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-4 py-5 text-center text-[12px]"
      style={{ color: "var(--devtools-fg-muted)" }}
    >
      {children}
    </div>
  );
}

import { TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

/**
 * Card-header tab strip — thin wrapper around the shadcn `TabsList` so memory
 * detail screens get the design's pill style (muted bg, active tab elevated
 * with shadow + ring) plus an optional mono count badge per tab. Must be
 * rendered inside a `<Tabs>` root from the same `ui/tabs` module.
 */
export interface MemoryTabSpec {
  value: string;
  label: string;
  count?: number;
}

export function MemoryCardTabs({ tabs }: { tabs: readonly MemoryTabSpec[] }) {
  return (
    <TabsList className="h-auto w-fit gap-0 rounded-[6px] border border-[var(--devtools-border)] bg-[var(--devtools-bg)] p-[2px] text-[12px]">
      {tabs.map((t) => (
        <TabsTrigger
          key={t.value}
          value={t.value}
          className="inline-flex h-auto flex-none items-center gap-1.5 rounded-[4px] border-0 px-3 py-[3px] text-[12px] leading-[14px] font-medium whitespace-nowrap text-[var(--devtools-fg-muted)] shadow-none data-[state=active]:bg-[var(--devtools-bg-elev)] data-[state=active]:font-semibold data-[state=active]:text-[var(--devtools-fg)] data-[state=active]:shadow-[0_1px_2px_rgba(0,0,0,0.05),inset_0_0_0_1px_var(--devtools-border)]"
        >
          {t.label}
          {t.count != null && (
            <span className="font-mono text-[10px] tabular-nums text-[var(--devtools-fg-faint)] group-data-[state=active]/tabs-list:text-[var(--devtools-crux)]">
              {t.count}
            </span>
          )}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

/**
 * Inline callout shown at the top of memory detail screens when the
 * server-joined `inspection` block reports projection-only (status !== 'ok').
 * Strictly presentational — renders the backend-provided `message` and
 * `docsUrl`. The projected memory state always renders alongside.
 */
export function MemoryInspectionNotice({
  inspection,
}: {
  inspection: MemoryInspection;
}) {
  if (inspection.status === "ok") return null;
  const message =
    inspection.message ??
    "Showing projected memory activity. Live runtime inspection is not available.";
  const docsHref = cruxDocsUrl(inspection.docsUrl);
  return (
    <div
      className="mb-4 flex items-start gap-2.5 rounded-[8px] px-3.5 py-2.5 text-[12px]"
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px dashed var(--devtools-border)",
        color: "var(--devtools-fg-muted)",
      }}
    >
      <Icon
        name="alert"
        size={14}
        color="var(--devtools-fg-faint)"
        className="mt-[2px] shrink-0"
      />
      <div className="min-w-0 flex-1">
        <span>{message}</span>
        {docsHref && (
          <>
            {" "}
            <a
              href={docsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
              style={{ color: "var(--devtools-crux)" }}
            >
              Learn more
            </a>
          </>
        )}
      </div>
      {inspection.reason && (
        <span
          className="ml-2 shrink-0 rounded-[3px] px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-[0.06em]"
          style={{
            background: "var(--devtools-bg-muted)",
            color: "var(--devtools-fg-faint)",
          }}
          title={`reason: ${inspection.reason}`}
        >
          {inspection.reason}
        </span>
      )}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="mb-4 rounded-[8px] px-4 py-3 text-[12px]"
      style={{ background: "var(--devtools-danger-soft)", color: "var(--devtools-danger)" }}
    >
      {message}
    </div>
  );
}
