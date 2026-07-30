/** Compact five-role evidence summary for the constant Inspector rail. */

import type { EvidenceRole } from "@use-crux/core/evidence";
import { projectEvidenceRoleSummary } from "./presentation";
import type {
  EvidenceApiRoleResult,
  EvidenceApiSubject,
} from "./types";
import { useEvidenceSummary } from "./useEvidenceInspection";

const roles = [
  "intent",
  "authority",
  "change",
  "verification",
  "recovery",
] as const satisfies readonly EvidenceRole[];

export function EvidenceInspectorSummary({
  subject,
  onOpen,
}: {
  readonly subject: EvidenceApiSubject;
  readonly onOpen: (role: EvidenceRole) => void;
}) {
  const summary = useEvidenceSummary(subject);
  if (summary.loading) {
    return <p className="text-[10px] text-(--devtools-fg-faint)">Loading…</p>;
  }
  if (!summary.result || summary.error) {
    return (
      <p className="text-[10px] text-(--devtools-fg-faint)">Unavailable</p>
    );
  }
  return (
    <div className="grid gap-1">
      {roles.map((role) => {
        const item = projectEvidenceRoleSummary(
          summary.result!.roles[role] as EvidenceApiRoleResult<EvidenceRole>,
        );
        return (
          <button
            key={role}
            type="button"
            onClick={() => onOpen(role)}
            className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-[5px] px-1.5 py-1 text-left hover:bg-(--devtools-bg-muted)"
          >
            <span className="text-[10px] text-(--devtools-fg-muted)">
              {item.label}
            </span>
            <span className="font-mono text-[9.5px] text-(--devtools-fg-faint)">
              {item.status.value}
              {item.conflicting ? " · conflict" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
