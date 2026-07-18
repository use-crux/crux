/**
 * "Freshness & cache" — the handover's hard rule made visual. Two columns that
 * never merge: freshness (clock) asks *was it current enough?*; cache (disk)
 * asks *what did reuse save?*. Each keeps its own header, glyph and explainer so
 * the page never implies "cache freshness".
 */

import type { ReactNode } from "react";
import { Icon } from "@/devtools/shell/Icon";
import type { IconName } from "@/devtools/shell/nav";
import { fmtAge } from "@/features/run-detail/lib/explain/format";
import { fmtTokens } from "@/features/run-detail/lib/span-detail-inspection";
import type {
  TurnCacheEvidence,
  TurnDecisionSubject,
  TurnFreshnessEvidence,
} from "@/types";
import { CacheChip, FreshnessChip } from "../atoms";

function subjectLabel(s: TurnDecisionSubject): string {
  return s.label ?? s.name ?? s.id ?? s.kind;
}

function Column({
  title,
  glyph,
  blurb,
  children,
}: {
  title: string;
  glyph: IconName;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <div
      className="min-w-0 flex-1 overflow-hidden rounded-[10px]"
      style={{
        background: "var(--devtools-bg)",
        border: "1px solid var(--devtools-border)",
      }}
    >
      <div
        className="flex items-center gap-2 px-3.5 py-[9px]"
        style={{
          borderBottom: "1px solid var(--devtools-border)",
          background: "var(--devtools-bg-elev)",
        }}
      >
        <Icon name={glyph} size={14} color="var(--devtools-fg-muted)" />
        <span className="text-[12.5px] font-semibold">{title}</span>
        <span
          className="text-[11.5px] italic"
          style={{ fontFamily: "var(--devtools-serif)", color: "var(--devtools-fg-faint)" }}
        >
          {blurb}
        </span>
      </div>
      {children}
    </div>
  );
}

function Row({
  chip,
  subject,
  meta,
  reason,
}: {
  chip: ReactNode;
  subject: string;
  meta?: ReactNode;
  reason: ReactNode;
}) {
  return (
    <div
      className="flex items-start gap-[10px] px-3.5 py-[9px]"
      style={{ borderBottom: "1px solid var(--devtools-border)" }}
    >
      <div className="w-[124px] flex-shrink-0">
        <div className="mb-1">{chip}</div>
        <div
          className="truncate font-mono text-[10px]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          {subject}
        </div>
        {meta && (
          <div
            className="mt-0.5 font-mono text-[9.5px]"
            style={{ color: "var(--devtools-fg-faint)" }}
          >
            {meta}
          </div>
        )}
      </div>
      <span
        className="min-w-0 flex-1 text-[12px] leading-[1.45]"
        style={{ fontFamily: "var(--devtools-serif)", color: "var(--devtools-fg-muted)" }}
      >
        {reason}
      </span>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      className="px-3.5 py-3 text-[11.5px]"
      style={{ color: "var(--devtools-fg-faint)" }}
    >
      {children}
    </div>
  );
}

export function FreshCacheBlock({
  freshness,
  cache,
}: {
  freshness: readonly TurnFreshnessEvidence[];
  cache: readonly TurnCacheEvidence[];
}) {
  return (
    <div className="flex gap-3">
      <Column title="Freshness" glyph="clock" blurb="was it current enough?">
        {freshness.length === 0 ? (
          <Empty>No freshness evidence was recorded for this turn.</Empty>
        ) : (
          freshness.map((f, i) => (
            <Row
              key={i}
              chip={<FreshnessChip status={f.status} />}
              subject={subjectLabel(f.subject)}
              meta={
                f.maxAgeMs != null
                  ? `age ${fmtAge(f.ageMs)} · max ${fmtAge(f.maxAgeMs)}`
                  : undefined
              }
              reason={f.reason ?? "—"}
            />
          ))
        )}
      </Column>
      <Column title="Cache" glyph="db" blurb="what did reuse save?">
        {cache.length === 0 ? (
          <Empty>No cache evidence was recorded for this turn.</Empty>
        ) : (
          cache.map((c, i) => (
            <Row
              key={i}
              chip={<CacheChip status={c.status} />}
              subject={subjectLabel(c.subject)}
              meta={
                c.savedTokens != null ? (
                  <span style={{ color: "var(--devtools-ok)" }}>
                    saved {fmtTokens(c.savedTokens)} tok
                  </span>
                ) : undefined
              }
              reason={
                c.reason ??
                (c.acceptedByFreshness
                  ? "Accepted by the freshness gate."
                  : "—")
              }
            />
          ))
        )}
      </Column>
    </div>
  );
}
