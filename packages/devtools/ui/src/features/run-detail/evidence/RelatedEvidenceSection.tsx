/** Bounded structural descendant index backed by complete Local counts. */

import type { EvidenceStructuralNode } from "./related-evidence";
import { useRelatedEvidence } from "./useRelatedEvidence";

export interface RelatedEvidenceSectionProps {
  readonly root: EvidenceStructuralNode;
  readonly selectedId: string;
  readonly onSelectSubject: (id: string) => void;
}

/** Render exact “Showing N of M” copy only after every Local chunk succeeds. */
export function RelatedEvidenceSection({
  root,
  selectedId,
  onSelectSubject,
}: RelatedEvidenceSectionProps) {
  const related = useRelatedEvidence({ root, selectedId, limit: 8 });
  if (related.loading) {
    return <RelatedState>Checking related evidence…</RelatedState>;
  }
  if (related.error || !related.result) {
    return (
      <RelatedState>
        Related evidence is unavailable; an exact total cannot be shown.
      </RelatedState>
    );
  }
  if (related.result.total === 0) return null;
  return (
    <section
      aria-label="Related evidence"
      className="mt-5 border-t border-(--devtools-border) pt-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[12px] font-semibold text-(--devtools-fg)">
          Related Evidence
        </h3>
        <span className="text-[10px] text-(--devtools-fg-faint)">
          Showing {related.result.showing} of {related.result.total} subjects
          with evidence
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {related.result.rows.map((row) => (
          <button
            key={row.subject.id}
            type="button"
            onClick={() => onSelectSubject(row.subject.id)}
            className="flex items-center justify-between rounded-[6px] border border-(--devtools-border) bg-(--devtools-bg-elev) px-2.5 py-2 text-left"
          >
            <span className="truncate text-[11px] text-(--devtools-fg)">
              {row.label}
            </span>
            <span className="font-mono text-[10px] text-(--devtools-fg-muted)">
              {row.recordCount}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function RelatedState({ children }: { readonly children: string }) {
  return (
    <p className="mt-4 text-[10.5px] text-(--devtools-fg-faint)">
      {children}
    </p>
  );
}
