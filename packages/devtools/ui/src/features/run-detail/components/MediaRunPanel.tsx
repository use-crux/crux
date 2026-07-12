/**
 * Purpose-built Runs panel for multimodal operations.
 *
 * Never renders thumbnails, media players, downloads, locators, IDs, refs, or
 * filenames. Transcript text is shown only when the projection marks it present.
 */

import type { MediaRunView } from "../lib/media-run-projection";

export function MediaRunPanel({ view }: { readonly view: MediaRunView }) {
  return (
    <section
      aria-label="Multimodal run"
      className="grid gap-3 rounded-lg border border-(--qw-border) p-3"
    >
      <header className="grid gap-1">
        <h3 className="text-sm font-semibold text-(--qw-fg)">
          {view.summary.primitive}
        </h3>
        <p className="text-xs text-(--qw-fg-muted)">
          {[
            view.summary.provider,
            view.summary.model,
            view.summary.executionKind,
            view.summary.calls !== undefined
              ? `${view.summary.calls} calls`
              : undefined,
            view.summary.durationMs !== undefined
              ? `${view.summary.durationMs} ms`
              : undefined,
            view.summary.status,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      <DescriptorList title="Inputs" descriptors={view.inputs} />
      <DescriptorList title="Outputs" descriptors={view.outputs} />

      <div aria-label="Attempt timeline" className="grid gap-1">
        <h4 className="text-xs font-medium text-(--qw-fg-muted)">Attempts</h4>
        <ol className="grid gap-1 text-xs">
          {view.attempts.map((attempt) => (
            <li key={attempt.spanId}>
              {attempt.primitive} · {attempt.status}
              {attempt.durationMs !== undefined ? ` · ${attempt.durationMs}ms` : ""}
            </li>
          ))}
        </ol>
      </div>

      <div aria-label="Transcript timeline" className="grid gap-1">
        <h4 className="text-xs font-medium text-(--qw-fg-muted)">Transcript</h4>
        {view.transcript.present ? (
          <ol className="grid gap-1 text-xs">
            {view.transcript.segments.map((segment, index) => (
              <li key={index}>
                {segment.speaker ? `${segment.speaker}: ` : ""}
                {segment.text ?? ""}
                {segment.start !== undefined && segment.end !== undefined
                  ? ` (${segment.start}–${segment.end}s)`
                  : ""}
              </li>
            ))}
          </ol>
        ) : (
          <p role="status" className="text-xs text-(--qw-fg-muted)">
            {view.transcript.reason === "export-absent"
              ? "Transcript text is absent in production-exported capture."
              : view.transcript.reason === "not-transcription"
                ? "This operation has no transcript timeline."
                : "No transcript segments were captured."}
          </p>
        )}
      </div>

      <div aria-label="Media lineage" className="grid gap-1">
        <h4 className="text-xs font-medium text-(--qw-fg-muted)">Lineage</h4>
        <ul className="grid gap-1 text-xs">
          {view.lineage.nodes.map((node) => (
            <li key={node.id}>
              {node.kind}: {node.label}
            </li>
          ))}
        </ul>
        {view.catalogJoinId ? (
          <p className="text-xs text-(--qw-fg-muted)">
            Catalog join {view.catalogJoinId}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function DescriptorList({
  title,
  descriptors,
}: {
  readonly title: string;
  readonly descriptors: MediaRunView["inputs"];
}) {
  return (
    <div aria-label={title} className="grid gap-1">
      <h4 className="text-xs font-medium text-(--qw-fg-muted)">{title}</h4>
      {descriptors.length === 0 ? (
        <p className="text-xs text-(--qw-fg-muted)">No descriptors.</p>
      ) : (
        <ul className="grid gap-1 text-xs">
          {descriptors.map((descriptor, index) => (
            <li key={`${descriptor.kind}-${index}`}>
              {[
                descriptor.kind,
                descriptor.mediaType,
                descriptor.sizeBytes !== undefined
                  ? `${descriptor.sizeBytes}B`
                  : undefined,
                descriptor.sourceCategory,
              ]
                .filter(Boolean)
                .join(" · ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
