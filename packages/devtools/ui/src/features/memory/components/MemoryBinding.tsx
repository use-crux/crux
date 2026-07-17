import { fmtRelative, shortTrace } from "@/features/memory/lib/memory-format";
import { Chip } from "@/qw/shell/primitives";
import { LDCard } from "./MemoryAtoms";
import type { MemoryBlockMetadata, MemoryStoreDetail } from "@/types";

export function DefinitionBindingCard({
  store,
  note,
}: {
  store: MemoryStoreDetail;
  note?: string;
}) {
  const rows: Array<[string, React.ReactNode]> = [];
  if (store.owner) {
    rows.push([
      "owner",
      <span style={{ color: "var(--qw-fg)" }}>{store.owner}</span>,
    ]);
  }
  if (store.label && store.label !== store.id) {
    rows.push([
      "label",
      <span style={{ color: "var(--qw-fg)" }}>{store.label}</span>,
    ]);
  }
  if (store.source) {
    rows.push([
      "source",
      <button
        type="button"
        className="font-mono text-left transition-opacity hover:opacity-80"
        style={{ color: "var(--qw-crux)" }}
        onClick={() => {
          window.location.href = `vscode://file${store.source!.file}:${store.source!.line}`;
        }}
        title={`Open ${store.source.file}:${store.source.line} in your editor`}
      >
        {store.source.file.split("/").slice(-3).join("/")}:{store.source.line}
      </button>,
    ]);
  }
  if (store.backend) {
    rows.push([
      "backend",
      <span style={{ color: "var(--qw-fg)" }}>{store.backend}</span>,
    ]);
  }
  if (store.captureMode) {
    rows.push([
      "capture",
      <span style={{ color: "var(--qw-fg)" }}>{store.captureMode}</span>,
    ]);
  }
  if (store.budget) {
    rows.push([
      "budget",
      <span style={{ color: "var(--qw-fg)" }}>
        {formatBudget(store.budget)}
      </span>,
    ]);
  }
  if (store.scope) {
    rows.push([
      "scope",
      <span>
        {store.scope.kind} ·{" "}
        <span
          className="font-mono"
          style={{ color: "var(--qw-crux)" }}
          title={store.scope.id}
        >
          {store.scope.id.length > 24
            ? `${store.scope.id.slice(0, 24)}…`
            : store.scope.id}
        </span>
      </span>,
    ]);
  }
  if (store.conflictPolicy) {
    rows.push([
      "conflict",
      <span style={{ color: "var(--qw-fg)" }}>{store.conflictPolicy}</span>,
    ]);
  }
  if (store.evictionPolicy) {
    rows.push([
      "eviction",
      <span style={{ color: "var(--qw-fg)" }}>{store.evictionPolicy}</span>,
    ]);
  }
  if (store.health) {
    rows.push([
      "health",
      <span style={{ color: "var(--qw-fg)" }}>{store.health}</span>,
    ]);
  }
  if (store.lastRunId) {
    rows.push([
      "last run",
      <span className="font-mono" style={{ color: "var(--qw-crux)" }}>
        {shortTrace(store.lastRunId)}
      </span>,
    ]);
  }
  if (store.lastTraceId && store.lastTraceId !== store.lastRunId) {
    rows.push([
      "last trace",
      <span className="font-mono" style={{ color: "var(--qw-crux)" }}>
        {shortTrace(store.lastTraceId)}
      </span>,
    ]);
  }
  if (store.stats?.lifetime?.startedAt) {
    rows.push([
      "started",
      <span style={{ color: "var(--qw-fg-muted)" }}>
        {fmtRelative(store.stats.lifetime.startedAt) ?? "—"}
      </span>,
    ]);
  }
  return (
    <LDCard title="Binding" padding="12px 14px">
      <div className="flex flex-col gap-1.5 font-mono text-[11.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2.5">
            <span style={{ color: "var(--qw-fg-faint)", minWidth: 80 }}>
              {k}
            </span>
            {v}
          </div>
        ))}
      </div>
      {note && (
        <div
          className="mt-2.5 pt-2.5 text-[12px] leading-[1.5]"
          style={{
            borderTop: "1px dashed var(--qw-border)",
            color: "var(--qw-fg-muted)",
            fontFamily: "var(--qw-serif, Georgia, serif)",
          }}
        >
          {note}
        </div>
      )}
      {store.blocks && store.blocks.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 border-t border-dashed border-(--qw-border) pt-3">
          <div
            className="font-mono text-[10px] uppercase tracking-[0.08em]"
            style={{ color: "var(--qw-fg-faint)" }}
          >
            blocks
          </div>
          <div className="flex flex-col gap-1.5">
            {store.blocks.map((block, index) => (
              <MemoryBlockBindingRow
                key={`${block.id ?? block.kind ?? "block"}:${index}`}
                block={block}
              />
            ))}
          </div>
        </div>
      )}
    </LDCard>
  );
}

function MemoryBlockBindingRow({ block }: { block: MemoryBlockMetadata }) {
  const label = block.id ?? block.kind ?? "block";
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-[6px] px-2.5 py-2"
      style={{
        background: "var(--qw-bg-muted)",
        border: "1px solid var(--qw-border)",
      }}
    >
      <span
        className="mr-1 font-mono text-[11.5px]"
        style={{ color: "var(--qw-crux)" }}
        title={label}
      >
        {label}
      </span>
      {block.kind && (
        <Chip tone="muted" mono>
          {block.kind}
        </Chip>
      )}
      {block.renderStrategy && (
        <Chip
          tone={
            block.renderStrategy === "disabled"
              ? "warn"
              : block.renderStrategy === "semantic"
                ? "ok"
                : "iris"
          }
          mono
        >
          render · {block.renderStrategy}
          {block.renderLimit != null ? `:${block.renderLimit}` : ""}
        </Chip>
      )}
      {block.writeMode && (
        <Chip tone={block.writeMode === "propose" ? "warn" : "crux"} mono>
          write · {block.writeMode}
        </Chip>
      )}
      {block.budget && (
        <Chip tone="gold" mono>
          budget · {formatBudget(block.budget)}
        </Chip>
      )}
      {block.retentionPolicy && (
        <Chip tone="plum" mono>
          retention · {block.retentionPolicy}
        </Chip>
      )}
      {block.hasEmbed && (
        <Chip tone="ok" mono>
          embed
        </Chip>
      )}
    </div>
  );
}

function formatBudget(budget: Record<string, unknown>): string {
  const maxTokens = budget.maxTokens;
  if (typeof maxTokens === "number")
    return `${maxTokens.toLocaleString()} tokens`;
  const entries = Object.entries(budget);
  if (entries.length === 0) return "configured";
  return entries
    .slice(0, 2)
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(" · ");
}
