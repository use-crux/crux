/**
 * "What the model saw" and "Checked but not sent" — one evidence row contract
 * under two filters. The rule that keeps it scannable: **decorate the
 * exception, not the baseline.** A calm row is just kind · name/id · tokens. A
 * chip appears only when the row carries a risk (notable freshness) or a trust
 * gap (degraded evidence). The "considered" filter adds the disposition chip,
 * the reason prose, and a `required` flag.
 */

import { Icon } from "@/devtools/shell/Icon";
import { InjectStateChip } from "@/shared/components/InjectionState";
import { fmtTokens } from "@/features/run-detail/lib/span-detail-inspection";
import {
  evidenceIsDegraded,
  freshnessIsNotable,
} from "@/features/run-detail/lib/explain/registries";
import type { TurnConsideredItem, TurnSawItem } from "@/types";
import { EvidenceLevel, FreshnessChip } from "../atoms";

function Identity({ name, id }: { name?: string; id?: string }) {
  return (
    <div className="min-w-0">
      <div
        className="truncate text-[12.5px] font-medium"
        style={{ color: "var(--devtools-fg)" }}
      >
        {name ?? id ?? "unnamed"}
      </div>
      {id && (
        <div
          className="truncate font-mono text-[10px]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          {id}
        </div>
      )}
    </div>
  );
}

/** A "saw" row — present in the rendered request for this turn. */
export function SawRow({
  item,
  onOpen,
}: {
  item: TurnSawItem;
  onOpen?: () => void;
}) {
  const fresh = item.freshness?.status;
  const notable = freshnessIsNotable(fresh);
  const degraded = evidenceIsDegraded(item.evidenceLevel);
  return (
    <div
      className="flex items-center gap-[10px] px-3.5 py-[9px]"
      style={{ borderBottom: "1px solid var(--devtools-border)" }}
    >
      <span className="flex-shrink-0">
        <InjectStateChip state="active" size="xs" />
      </span>
      <div className="min-w-0 flex-1">
        <Identity name={item.name} id={item.id} />
      </div>
      {(notable || degraded) && (
        <span className="flex flex-shrink-0 items-center gap-2">
          {notable && fresh && <FreshnessChip status={fresh} />}
          {degraded && <EvidenceLevel value={item.evidenceLevel} />}
        </span>
      )}
      <span
        className="w-[64px] flex-shrink-0 text-right font-mono text-[11px]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        {item.tokens != null ? `${fmtTokens(item.tokens)} tok` : "—"}
      </span>
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="flex-shrink-0"
        style={{ cursor: onOpen ? "pointer" : "default" }}
        aria-label={onOpen ? "Open in Context" : undefined}
      >
        <Icon name="arrowRight" size={13} color="var(--devtools-fg-faint)" />
      </button>
    </div>
  );
}

/** A "considered" row — evaluated as a candidate, but did not reach the model. */
export function ConsideredRow({ item }: { item: TurnConsideredItem }) {
  return (
    <div
      className="flex items-center gap-[10px] px-3.5 py-[9px]"
      style={{ borderBottom: "1px solid var(--devtools-border)" }}
    >
      <div className="w-[180px] flex-shrink-0">
        <Identity name={item.name} id={item.id} />
      </div>
      <span className="flex-shrink-0">
        <InjectStateChip state={item.disposition} size="xs" />
      </span>
      <span
        className="min-w-0 flex-1 text-[12.5px] leading-[1.4]"
        style={{ fontFamily: "var(--devtools-serif)", color: "var(--devtools-fg-muted)" }}
      >
        {item.reason?.text ?? "—"}
      </span>
      {item.required && (
        <span
          className="flex-shrink-0 rounded-[3px] px-[6px] py-px font-mono text-[9.5px]"
          style={{
            color: "var(--devtools-danger)",
            background: "var(--devtools-danger-soft)",
            boxShadow: "inset 0 0 0 1px var(--devtools-danger-line)",
          }}
        >
          required
        </span>
      )}
      <span
        className="w-[56px] flex-shrink-0 text-right font-mono text-[11px]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        {item.tokens ? `${fmtTokens(item.tokens)} tok` : "—"}
      </span>
    </div>
  );
}
