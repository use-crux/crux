/**
 * "Missing evidence" — what Crux could not prove from recorded data. Neutral and
 * factual: these are gaps in the report's *own* proof, not bugs in the user's
 * system, so they never take severity colour. An empty list reads as a calm
 * "fully proven" confirmation rather than a blank.
 */

import { Icon } from "@/qw/shell/Icon";
import type { TurnDecisionDiagnostic } from "@/types";
import { EvidenceLevel } from "../atoms";

export function GapsBlock({
  gaps,
}: {
  gaps: readonly TurnDecisionDiagnostic[];
}) {
  if (gaps.length === 0) {
    return (
      <div
        className="flex items-center gap-2.5 rounded-[10px] px-4 py-3"
        style={{
          background: "var(--qw-ok-soft)",
          border: "1px solid var(--qw-ok-soft)",
        }}
      >
        <Icon name="check" size={15} color="var(--qw-ok)" />
        <span
          className="text-[12.5px] font-semibold"
          style={{ color: "var(--qw-fg)" }}
        >
          Fully proven
        </span>
        <span className="text-[12.5px]" style={{ color: "var(--qw-fg-muted)" }}>
          Every part of this turn is backed by recorded evidence.
        </span>
      </div>
    );
  }
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{
        background: "var(--qw-bg)",
        border: "1px solid var(--qw-border)",
      }}
    >
      {gaps.map((g, i) => (
        <div
          key={i}
          className="flex items-start gap-[11px] px-3.5 py-2.5"
          style={{
            borderBottom:
              i < gaps.length - 1 ? "1px solid var(--qw-border)" : "none",
          }}
        >
          <Icon name="info" size={14} color="var(--qw-fg-faint)" />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px]" style={{ color: "var(--qw-fg)" }}>
              {g.text}
            </div>
            {g.detail && (
              <div
                className="mt-0.5 text-[11.5px]"
                style={{ color: "var(--qw-fg-muted)" }}
              >
                {g.detail}
              </div>
            )}
          </div>
          {g.subject?.id && (
            <span
              className="flex-shrink-0 font-mono text-[10px]"
              style={{ color: "var(--qw-fg-faint)" }}
            >
              {g.subject.id}
            </span>
          )}
          <span className="flex-shrink-0">
            <EvidenceLevel value={g.evidenceLevel} />
          </span>
        </div>
      ))}
    </div>
  );
}
