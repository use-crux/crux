/** Canonical five-role execution-evidence panel for a selected Run subject. */

import type { EvidenceRole } from "@use-crux/core/evidence";
import { Chip, type ChipTone } from "@/devtools/shell/primitives";
import { projectEvidenceRole } from "./presentation";
import type { EvidenceApiRoleResult, EvidenceApiSubject } from "./types";
import { EvidenceRecordCard } from "./EvidenceRecordCard";
import { RelatedEvidenceSection } from "./RelatedEvidenceSection";
import type { EvidenceStructuralNode } from "./related-evidence";
import { useEvidenceInspection } from "./useEvidenceInspection";
import { useEvidenceNavigation } from "./useEvidenceNavigation";
import type { EvidenceApiNavigationTarget } from "./types";

const roles = [
  "intent",
  "authority",
  "change",
  "verification",
  "recovery",
] as const satisfies readonly EvidenceRole[];

export interface EvidencePanelProps {
  readonly subject: EvidenceApiSubject;
  readonly selectedRole: EvidenceRole;
  readonly selectedEvidenceId?: string;
  readonly onSelectRole: (role: EvidenceRole) => void;
  readonly onSelectRecord?: (role: EvidenceRole, evidenceId: string) => void;
  readonly onNavigateTarget: (target: EvidenceApiNavigationTarget) => void;
  readonly relatedRoot?: EvidenceStructuralNode;
  readonly selectedNodeId?: string;
  readonly onSelectRelatedSubject?: (id: string) => void;
}

/** Render Local's aggregates directly; never infer role truth from row count. */
export function EvidencePanel({
  subject,
  selectedRole,
  selectedEvidenceId,
  onSelectRole,
  onSelectRecord,
  onNavigateTarget,
  relatedRoot,
  selectedNodeId,
  onSelectRelatedSubject,
}: EvidencePanelProps) {
  const inspection = useEvidenceInspection(subject, selectedRole);
  const selectedResult = inspection.result?.roles[selectedRole] as
    | EvidenceApiRoleResult<EvidenceRole>
    | undefined;
  const navigation = useEvidenceNavigation(
    selectedResult
      ? [...selectedResult.records, ...(selectedResult.history ?? [])].flatMap(
          (record) => [
            record.source,
            ...(record.producer ? [record.producer] : []),
          ],
        )
      : [],
  );
  if (inspection.loading) return <PanelState>Loading evidence…</PanelState>;
  if (inspection.error || !inspection.result || !selectedResult) {
    return (
      <PanelState>
        Evidence is unavailable from the canonical local inspector.
      </PanelState>
    );
  }

  const selected = projectEvidenceRole(selectedResult);
  const resolvedTarget = (ref: EvidenceApiSubject) => {
    const result = navigation.resultFor(ref);
    return result?.status === "resolved" ? result.target : undefined;
  };
  return (
    <section
      aria-label="Execution evidence"
      className="flex h-full min-h-0 flex-col bg-(--devtools-bg)"
    >
      <div
        role="list"
        aria-label="Evidence role summary"
        data-evidence-role-list="scroll"
        className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-(--devtools-border) p-2 sm:grid sm:grid-cols-5 sm:overflow-visible"
      >
        {roles.map((role) => {
          const summary = projectEvidenceRole(
            inspection.result!.roles[
              role
            ] as EvidenceApiRoleResult<EvidenceRole>,
          );
          const selectedNow = role === selectedRole;
          return (
            <div
              key={role}
              role="listitem"
              className="w-[136px] shrink-0 sm:w-auto"
            >
              <button
                type="button"
                aria-pressed={selectedNow}
                onClick={() => onSelectRole(role)}
                className="h-full w-full rounded-[7px] border px-2 py-2 text-left"
                style={{
                  borderColor: selectedNow
                    ? "var(--devtools-crux-line)"
                    : "var(--devtools-border)",
                  background: selectedNow
                    ? "var(--devtools-crux-soft)"
                    : "var(--devtools-bg-elev)",
                }}
              >
                <div className="text-[11px] font-semibold text-(--devtools-fg)">
                  {summary.label}
                </div>
                <div className="mt-1 text-[9.5px] leading-snug text-(--devtools-fg-muted)">
                  {summary.status.label}
                </div>
                <div className="mt-1 min-h-3 font-mono text-[9px] text-(--devtools-fg-faint)">
                  {summary.conflicting
                    ? `Conflict · ${summary.activeRecordCount}`
                    : `${summary.activeRecordCount} active`}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-[15px] font-semibold text-(--devtools-fg)">
            {selected.label}
          </h2>
          <Chip tone={selected.status.tone as ChipTone} dot>
            {selected.status.label}
          </Chip>
          {selected.conclusion ? (
            <Chip tone="muted">Conclusion · {selected.conclusion}</Chip>
          ) : null}
        </div>

        {selected.conflicting ? (
          <div
            role="status"
            className="mb-3 rounded-[8px] border px-3 py-2 text-[11px]"
            style={{
              borderColor: "var(--devtools-warn)",
              background: "var(--devtools-warn-soft)",
              color: "var(--devtools-warn)",
            }}
          >
            Conflicting conclusions · Crux preserves every claim and does not
            select truth.
          </div>
        ) : null}

        {selected.records.length === 0 ? (
          <div className="rounded-[8px] border border-(--devtools-border) bg-(--devtools-bg-elev) px-3 py-4 text-[12px] text-(--devtools-fg-muted)">
            {selected.status.label}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {selected.records.map((record) => (
              <EvidenceRecordCard
                key={record.id}
                record={record}
                selected={record.id === selectedEvidenceId}
                onSelect={() => onSelectRecord?.(selectedRole, record.id)}
                onNavigateRef={(ref) => {
                  const target = resolvedTarget(ref);
                  if (target) onNavigateTarget(target);
                }}
                canNavigateRef={(ref) => resolvedTarget(ref) !== undefined}
              />
            ))}
          </div>
        )}

        {selected.history.length > 0 ? (
          <details className="mt-4 rounded-[8px] border border-(--devtools-border) bg-(--devtools-bg-elev)">
            <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-(--devtools-fg-muted)">
              History · {selected.history.length}
            </summary>
            <div className="flex flex-col gap-2 border-t border-(--devtools-border) p-2">
              {selected.history.map((record) => (
                <EvidenceRecordCard
                  key={record.id}
                  record={record}
                  selected={record.id === selectedEvidenceId}
                  onSelect={() => onSelectRecord?.(selectedRole, record.id)}
                  onNavigateRef={(ref) => {
                    const target = resolvedTarget(ref);
                    if (target) onNavigateTarget(target);
                  }}
                  canNavigateRef={(ref) => resolvedTarget(ref) !== undefined}
                />
              ))}
            </div>
          </details>
        ) : null}

        {selected.truncated ? (
          <p className="mt-3 text-[10.5px] text-(--devtools-warn)">
            Result may be incomplete because retained evidence or history is no
            longer resolvable.
          </p>
        ) : null}
        {inspection.hasOlder ? (
          <button
            type="button"
            disabled={inspection.fetchingMore}
            onClick={() => void inspection.loadOlder()}
            className="mt-3 rounded-[6px] border border-(--devtools-border) bg-(--devtools-bg-elev) px-3 py-1.5 text-[11px] text-(--devtools-fg)"
          >
            {inspection.fetchingMore ? "Loading…" : "Load older"}
          </button>
        ) : null}
        <div aria-live="polite" className="sr-only">
          {selected.records.length} of {selected.activeRecordCount} evidence
          records loaded
        </div>
        {relatedRoot && selectedNodeId && onSelectRelatedSubject ? (
          <RelatedEvidenceSection
            root={relatedRoot}
            selectedId={selectedNodeId}
            onSelectSubject={onSelectRelatedSubject}
          />
        ) : null}
      </div>
    </section>
  );
}

function PanelState({ children }: { readonly children: string }) {
  return (
    <div className="px-4 py-6 text-[12px] text-(--devtools-fg-muted)">
      {children}
    </div>
  );
}
