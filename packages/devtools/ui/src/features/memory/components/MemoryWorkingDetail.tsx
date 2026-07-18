import { useMemo } from "react";
import { Chip, SectionHead } from "@/devtools/shell/primitives";
import {
  fmtDuration,
  fmtTime,
  fmtValue,
  healthTone,
  parseLiveFields,
  shortTrace,
  typeMeta,
} from "@/features/memory/lib/memory-format";
import { DefinitionBindingCard } from "./MemoryBinding";
import {
  EmptyHint,
  EmptyInline,
  LDCard,
  LDHeaderStrip,
  LDKV,
  LDOpPill,
  TableHeader,
} from "./MemoryAtoms";
import { SchemaCard } from "./MemorySchema";
import type {
  MemoryStoreDetail,
  MemoryWorkingField,
  MemoryWorkingMutation,
  MemoryWorkingState,
} from "@/types";

export function WorkingDetail({
  store,
  state,
}: {
  store: MemoryStoreDetail;
  state: MemoryWorkingState;
}) {
  const m = typeMeta("working");
  const fields = state.fields ?? [];
  const muts = state.mutations ?? [];

  // Overlay live values onto projected rows when the bridge is up; falls
  // through to projected fields when no live data is available. Schema view
  // lives in the separate SchemaCard on the right column, so no tab strip.
  const liveFields = useMemo(
    () => parseLiveFields(store.inspection),
    [store.inspection],
  );
  const displayFields = useMemo<readonly MemoryWorkingField[]>(() => {
    if (!liveFields) return fields;
    const byName = new Map(fields.map((f) => [f.name, f]));
    const seen = new Set<string>();
    const out: MemoryWorkingField[] = [];
    for (const lf of liveFields) {
      const projected = byName.get(lf.name);
      seen.add(lf.name);
      out.push({
        ...(projected ?? {}),
        name: lf.name,
        ty: projected?.ty ?? lf.ty,
        value: lf.value,
        updatedAt: lf.writtenAt ?? projected?.updatedAt,
      } as MemoryWorkingField);
    }
    for (const f of fields) if (!seen.has(f.name)) out.push(f);
    return out;
  }, [liveFields, fields]);

  const lifetimeStr = fmtDuration(store.stats?.lifetime?.durationMs);
  const lastAt = fmtTime(store.stats?.lifetime?.lastTouchedAt);
  const writes = muts.filter((m) => m.op === "write").length;
  const updates = muts.filter(
    (m) => m.op === "update" || m.op === "append",
  ).length;

  return (
    <>
      <LDHeaderStrip
        icon={m.icon}
        color={m.color}
        id={store.id}
        chips={
          <>
            <Chip tone={m.tone} mono>
              {m.label}
            </Chip>
            <Chip tone={healthTone(store.health)} dot>
              {store.health}
            </Chip>
            {lastAt && (
              <span
                className="font-mono text-[11px]"
                style={{ color: "var(--devtools-fg-faint)" }}
              >
                last · {lastAt}
              </span>
            )}
          </>
        }
        stats={[
          { label: "Fields", value: fields.length },
          { label: "Reads", value: store.stats?.reads ?? "—" },
          { label: "Writes", value: writes || store.stats?.writes || 0 },
          { label: "Updates", value: updates || 0 },
          {
            label: "Conflicts",
            value: store.stats?.conflicts ?? 0,
            color:
              (store.stats?.conflicts ?? 0) > 0
                ? "var(--devtools-warn)"
                : "var(--devtools-fg-faint)",
          },
          ...(lifetimeStr ? [{ label: "Lifetime", value: lifetimeStr }] : []),
        ]}
        right={
          store.scope && (
            <>
              <span
                className="font-mono text-[11px]"
                style={{ color: "var(--devtools-fg-faint)" }}
              >
                scope
              </span>
              <Chip tone={m.tone} mono>
                {store.scope.kind} ·{" "}
                {shortTrace(store.scope.id) ?? store.scope.id}
              </Chip>
            </>
          )
        }
      />

      <div
        className="mb-5 grid gap-4"
        style={{ gridTemplateColumns: "1.4fr 1fr" }}
      >
        <LDCard title="Current state" color={m.color}>
          {displayFields.length === 0 ? (
            <EmptyInline>No fields captured yet.</EmptyInline>
          ) : (
            displayFields.map((f, i) => (
              <LDKV
                key={f.name}
                k={f.name}
                type={f.ty}
                v={fmtValue(f.value)}
                last={i === displayFields.length - 1}
              />
            ))
          )}
        </LDCard>

        <div className="flex flex-col gap-3.5">
          <SchemaCard
            schema={store.schema}
            inferredFields={fields.map((f) => ({ name: f.name, ty: f.ty }))}
            color={m.color}
            authoringHint="workingState({ schema })"
          />
          <DefinitionBindingCard store={store} />
        </div>
      </div>

      <MutationHistory muts={muts} />
    </>
  );
}

function MutationHistory({ muts }: { muts: readonly MemoryWorkingMutation[] }) {
  if (muts.length === 0) {
    return (
      <section>
        <SectionHead eyebrow="Mutation history" />
        <EmptyHint>No mutations captured yet.</EmptyHint>
      </section>
    );
  }
  const hasSpan = muts.some((m) => m.span || m.spanId);
  const hasTrace = muts.some((m) => m.traceId);
  return (
    <section>
      <SectionHead
        eyebrow="Mutation history"
        right={
          <span
            className="font-mono text-[11px]"
            style={{ color: "var(--devtools-fg-faint)" }}
          >
            {muts.length} writes/updates · before → after
          </span>
        }
      />
      <div
        className="overflow-hidden rounded-[10px]"
        style={{
          background: "var(--devtools-bg-elev)",
          border: "1px solid var(--devtools-border)",
        }}
      >
        <TableHeader
          cols={[
            { label: "time", width: "70px" },
            { label: "op", width: "70px" },
            { label: "key", width: "180px" },
            { label: "before", width: "minmax(0, 1fr)" },
            { label: "after", width: "minmax(0, 1fr)" },
            ...(hasSpan
              ? [{ label: "source span", width: "minmax(0, 1fr)" }]
              : []),
            ...(hasTrace
              ? [{ label: "trace", width: "70px", align: "right" as const }]
              : []),
          ]}
        />
        {muts.map((m, i) => (
          <div
            key={m.eventId}
            className="grid items-center gap-2.5 px-4 py-2.5 font-mono text-[11.5px]"
            style={{
              gridTemplateColumns: [
                "70px",
                "70px",
                "180px",
                "minmax(0, 1fr)",
                "minmax(0, 1fr)",
                hasSpan ? "minmax(0, 1fr)" : "",
                hasTrace ? "70px" : "",
              ]
                .filter(Boolean)
                .join(" "),
              borderBottom:
                i === muts.length - 1 ? "none" : "1px solid var(--devtools-border)",
            }}
          >
            <span style={{ color: "var(--devtools-fg-faint)" }}>
              {fmtTime(m.timestamp)}
            </span>
            <LDOpPill op={m.op} />
            <span style={{ color: "var(--devtools-crux)" }}>{m.key}</span>
            <span
              className="truncate"
              style={{ color: "var(--devtools-fg-muted)" }}
              title={fmtValue(m.before)}
            >
              {fmtValue(m.before)}
            </span>
            <span
              className="truncate"
              style={{ color: "var(--devtools-fg)" }}
              title={fmtValue(m.after)}
            >
              {fmtValue(m.after)}
            </span>
            {hasSpan && (
              <span
                className="truncate text-[10.5px]"
                style={{ color: "var(--devtools-fg-muted)" }}
                title={m.span ?? m.spanId}
              >
                {m.span ?? m.spanId ?? "—"}
              </span>
            )}
            {hasTrace && (
              <span className="text-right" style={{ color: "var(--devtools-crux)" }}>
                {shortTrace(m.traceId) ?? "—"}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
