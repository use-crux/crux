/**
 * "How this is protected" — the coverage gauge plus a per-area scorecard.
 * Uncovered areas show a **read-only** suggested assertion (dashed mono) and an
 * optional copyable CLI hint. The UI never fakes a "create test" write: tests
 * are authored in code and run from the CLI as Evals.
 */

import { Icon } from "@/devtools/shell/Icon";
import type { TurnDecisionCoverage } from "@/types";
import { CoverageChip, CoverageGauge } from "../atoms";

export function ProtectBlock({ coverage }: { coverage: TurnDecisionCoverage }) {
  return (
    <div
      className="overflow-hidden rounded-[12px]"
      style={{
        background: "var(--devtools-bg)",
        border: "1px solid var(--devtools-border)",
      }}
    >
      <div
        className="px-4 py-3.5"
        style={{
          borderBottom: "1px solid var(--devtools-border)",
          background: "var(--devtools-bg-elev)",
        }}
      >
        <CoverageGauge covered={coverage.covered} total={coverage.total} />
      </div>
      {coverage.areas.map((a, i) => (
        <div
          key={a.id}
          className="flex items-center gap-3 px-4 py-2.5"
          style={{
            borderBottom:
              i < coverage.areas.length - 1
                ? "1px solid var(--devtools-border)"
                : "none",
          }}
        >
          <span
            className="w-[170px] flex-shrink-0 text-[12.5px] font-medium"
            style={{ color: "var(--devtools-fg)" }}
          >
            {a.label}
          </span>
          <span className="w-[132px] flex-shrink-0">
            <CoverageChip status={a.status} />
          </span>
          {a.suggestion ? (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className="text-[12.5px] italic"
                style={{
                  fontFamily: "var(--devtools-serif)",
                  color: "var(--devtools-fg-muted)",
                }}
              >
                suggest
              </span>
              <span
                className="min-w-0 flex-1 truncate font-mono text-[11px]"
                style={{
                  color: "var(--devtools-fg)",
                  background: "var(--devtools-bg-muted)",
                  border: "1px dashed var(--devtools-border-strong)",
                  borderRadius: 5,
                  padding: "2px 8px",
                }}
                title={
                  a.command ? `${a.suggestion} — ${a.command}` : a.suggestion
                }
              >
                {a.suggestion}
              </span>
            </span>
          ) : (
            <span className="flex-1" />
          )}
        </div>
      ))}
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ background: "var(--devtools-bg-elev)" }}
      >
        <Icon name="info" size={12} color="var(--devtools-fg-faint)" />
        <span className="text-[11.5px]" style={{ color: "var(--devtools-fg-faint)" }}>
          Suggestions are read-only. Assertions are authored in code, then run
          from the CLI.
        </span>
      </div>
    </div>
  );
}
