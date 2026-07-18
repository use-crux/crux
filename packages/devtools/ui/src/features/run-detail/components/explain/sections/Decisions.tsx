/**
 * "Decisions" — runtime control folded into this turn, summarised. Each row is
 * `KindTag · subject + outcome · reason · evidence-level (by exception) ·
 * coverage gap · → open <Tab>`. Routing/fallback/cache/security/guardrail/
 * compaction each link to their existing deep tab; Explain never duplicates the
 * full evidence.
 */

import { KindTag } from "../../atoms";
import { evidenceIsDegraded } from "@/features/run-detail/lib/explain/registries";
import type { TurnDecision } from "@/types";
import { EvidenceLevel, CoverageChip } from "../atoms";
import { OpenTabLink } from "../band";

export function DecisionRow({
  decision,
  onOpen,
}: {
  decision: TurnDecision;
  onOpen?: () => void;
}) {
  const subject =
    decision.subject.label ??
    decision.subject.name ??
    decision.subject.id ??
    decision.subject.kind;
  const degraded = evidenceIsDegraded(decision.reason.evidenceLevel);
  const uncovered = decision.coverage?.status === "none";
  return (
    <div
      className="flex items-center gap-[11px] px-3.5 py-2.5"
      style={{ borderBottom: "1px solid var(--devtools-border)" }}
    >
      <span className="flex-shrink-0">
        <KindTag kind={decision.kind} size={9} />
      </span>
      <div className="w-[150px] flex-shrink-0 min-w-0">
        <div
          className="truncate text-[12px] font-semibold"
          style={{ color: "var(--devtools-fg)" }}
        >
          {subject}
        </div>
        <div
          className="truncate text-[11px]"
          style={{ color: "var(--devtools-fg-muted)" }}
        >
          {decision.outcome}
        </div>
      </div>
      <span
        className="min-w-0 flex-1 text-[12.5px] leading-[1.4]"
        style={{ fontFamily: "var(--devtools-serif)", color: "var(--devtools-fg-muted)" }}
      >
        {decision.reason.text}
      </span>
      {degraded && (
        <span className="flex-shrink-0" title="this reason is not fully proven">
          <EvidenceLevel
            value={decision.reason.evidenceLevel}
            showLabel={false}
          />
        </span>
      )}
      {uncovered && (
        <span className="flex-shrink-0">
          <CoverageChip status="none" />
        </span>
      )}
      <span className="w-[92px] flex-shrink-0 text-right">
        {decision.tab && (
          <OpenTabLink label={`open ${decision.tab.tab}`} onClick={onOpen} />
        )}
      </span>
    </div>
  );
}
