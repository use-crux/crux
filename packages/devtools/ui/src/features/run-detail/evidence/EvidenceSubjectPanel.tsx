/** Selected-subject Detail/Evidence switch for Run Detail's center pane. */

import type { ReactNode } from "react";
import type { EvidenceRole } from "@use-crux/core/evidence";
import { useNavigation } from "@/app/navigation/useNavigation";
import type { ObservabilityRunDetail } from "@/types";
import type { RunLens } from "../types";
import { findNode } from "../lib/span-detail-inspection";
import { EvidencePanel } from "./EvidencePanel";
import type {
  EvidenceApiNavigationTarget,
  EvidenceApiSubject,
} from "./types";

export interface EvidenceSubjectPanelProps {
  readonly detail: ObservabilityRunDetail | null;
  readonly selectedNodeId: string | null;
  readonly traceId: string;
  readonly lens: RunLens;
  readonly detailTab?: "evidence";
  readonly evidenceRole?: EvidenceRole;
  readonly evidenceId?: string;
  readonly children: ReactNode;
}

/** Convert a selected presentation node into its canonical graph subject. */
export function evidenceSubjectForSelection(
  detail: ObservabilityRunDetail | null,
  selectedNodeId: string | null,
): EvidenceApiSubject | undefined {
  if (!detail?.root || !detail.run?.runId) return undefined;
  const node = findNode(detail.root, selectedNodeId) ?? detail.root;
  if (
    selectedNodeId !== null &&
    node.spanId === selectedNodeId &&
    node.kind !== "run"
  ) {
    return { kind: "execution", id: node.spanId };
  }
  return node.id === detail.root.id || node.kind === "run"
    ? { kind: "execution", id: detail.run.runId }
    : { kind: "execution", id: node.spanId || node.id };
}

/** Keep the existing native detail intact and add evidence as a peer tab. */
export function EvidenceSubjectPanel({
  detail,
  selectedNodeId,
  traceId,
  lens,
  detailTab,
  evidenceRole = "intent",
  evidenceId,
  children,
}: EvidenceSubjectPanelProps) {
  const { navigate } = useNavigation();
  const subject = evidenceSubjectForSelection(detail, selectedNodeId);
  if (!subject || !detail) return children;
  const active = detailTab === "evidence" ? "evidence" : "detail";
  const selectEvidence = (
    role: EvidenceRole = evidenceRole,
    selectedId: string | undefined = evidenceId,
  ) =>
    navigate({
      view: "run-detail",
      traceId,
      lens,
      ...(selectedNodeId ? { spanId: selectedNodeId } : {}),
      detailTab: "evidence",
      evidenceRole: role,
      ...(selectedId ? { evidenceId: selectedId } : {}),
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Selected subject detail"
        className="flex shrink-0 gap-1 border-b border-(--devtools-border) bg-(--devtools-bg) px-2.5 py-2"
      >
        <button
          id="selected-subject-detail-tab"
          type="button"
          role="tab"
          aria-selected={active === "detail"}
          aria-controls="selected-subject-panel"
          onClick={() =>
            navigate({
              view: "run-detail",
              traceId,
              lens,
              ...(selectedNodeId ? { spanId: selectedNodeId } : {}),
            })
          }
          className="rounded-[6px] px-3 py-1.5 text-[11px]"
          style={{
            color:
              active === "detail"
                ? "var(--devtools-crux)"
                : "var(--devtools-fg-muted)",
            background:
              active === "detail"
                ? "var(--devtools-crux-soft)"
                : "transparent",
          }}
        >
          Detail
        </button>
        <button
          id="selected-subject-evidence-tab"
          type="button"
          role="tab"
          aria-selected={active === "evidence"}
          aria-controls="selected-subject-panel"
          onClick={() => selectEvidence()}
          className="rounded-[6px] px-3 py-1.5 text-[11px]"
          style={{
            color:
              active === "evidence"
                ? "var(--devtools-crux)"
                : "var(--devtools-fg-muted)",
            background:
              active === "evidence"
                ? "var(--devtools-crux-soft)"
                : "transparent",
          }}
        >
          Evidence
        </button>
      </div>
      <div
        id="selected-subject-panel"
        role="tabpanel"
        aria-labelledby={
          active === "evidence"
            ? "selected-subject-evidence-tab"
            : "selected-subject-detail-tab"
        }
        className="min-h-0 flex-1 overflow-hidden"
      >
        {active === "detail" ? (
          children
        ) : (
          <EvidencePanel
            subject={subject}
            selectedRole={evidenceRole}
            selectedEvidenceId={evidenceId}
            onSelectRole={(role) => selectEvidence(role, undefined)}
            onSelectRecord={(role, id) => selectEvidence(role, id)}
            relatedRoot={detail.root}
            selectedNodeId={selectedNodeId ?? detail.root.id}
            onSelectRelatedSubject={(id) =>
              navigate({
                view: "run-detail",
                traceId,
                lens,
                spanId: id,
                detailTab: "evidence",
                evidenceRole,
              })
            }
            onNavigateTarget={(target) =>
              navigate(resolveEvidenceNavigationTarget(target))
            }
          />
        )}
      </div>
    </div>
  );
}

/** Convert one exact Local navigation target into Run Detail navigation. */
export function resolveEvidenceNavigationTarget(
  target: EvidenceApiNavigationTarget,
) {
  if (target.kind === "span") {
    return {
      view: "run-detail" as const,
      traceId: target.runId,
      lens: "tree" as const,
      spanId: target.spanId,
    };
  }
  if (target.kind === "artifact" && target.owner.kind === "span") {
    return {
      view: "run-detail" as const,
      traceId: target.runId,
      lens: "tree" as const,
      spanId: target.owner.spanId,
    };
  }
  return {
    view: "run-detail" as const,
    traceId: target.runId,
    lens: "tree" as const,
  };
}

/** Resolve only targets proven by the currently loaded canonical run model. */
export function resolveEvidenceNavigation(
  detail: ObservabilityRunDetail,
  traceId: string,
  ref: EvidenceApiSubject,
) {
  if (ref.kind === "execution") {
    if (ref.id === detail.run.runId) {
      return {
        view: "run-detail" as const,
        traceId,
        lens: "tree" as const,
      };
    }
    const node = findNode(detail.root, ref.id);
    return node
      ? {
          view: "run-detail" as const,
          traceId,
          lens: "tree" as const,
          spanId: node.id,
        }
      : undefined;
  }
  return undefined;
}
