/**
 * Purpose-built Runs panel for multimodal operations.
 *
 * Never renders thumbnails, media players, downloads, locators, IDs, refs, or
 * filenames. Transcript text is shown only when the projection marks it present.
 * Catalog definition ids stay internal for navigation; only human labels render.
 */

import { formatMediaAttribution } from "../lib/media-run-attribution";
import { BoundedMediaStreamCard } from "./BoundedMediaStreamCard";
import { MediaRunAttemptTimeline } from "./MediaRunAttemptTimeline";
import type {
  MediaCatalogJoin,
  MediaLineageEdge,
  MediaLineageNode,
  MediaRunView,
} from "../lib/media-run-projection";

export function MediaRunPanel({
  view,
  onOpenCatalog,
}: {
  readonly view: MediaRunView;
  /** Navigate using the internal definition id — never shown as text. */
  readonly onOpenCatalog?: (definitionId: string) => void;
}) {
  return (
    <section
      aria-label="Multimodal run"
      className="grid gap-3 rounded-lg border border-(--devtools-border) p-3"
    >
      <header className="grid gap-1">
        <h3 className="text-sm font-semibold text-(--devtools-fg)">
          {view.summary.primitive}
        </h3>
        <p className="text-xs text-(--devtools-fg-muted)">
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

      {view.boundedStream ? (
        <BoundedMediaStreamCard stream={view.boundedStream} />
      ) : null}

      <DescriptorList title="Inputs" descriptors={view.inputs} />
      <DescriptorList title="Outputs" descriptors={view.outputs} />
      <MediaRunAttemptTimeline attempts={view.attempts} />

      <div aria-label="Transcript timeline" className="grid gap-1">
        <h4 className="text-xs font-medium text-(--devtools-fg-muted)">Transcript</h4>
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
          <p role="status" className="text-xs text-(--devtools-fg-muted)">
            {view.transcript.reason === "export-absent"
              ? "Transcript text is absent in production-exported capture."
              : view.transcript.reason === "not-transcription"
                ? "This operation has no transcript timeline."
                : "No transcript segments were captured."}
          </p>
        )}
      </div>

      <LineageSection
        nodes={view.lineage.nodes}
        edges={view.lineage.edges}
        catalogJoin={view.catalogJoin}
        onOpenCatalog={onOpenCatalog}
      />
    </section>
  );
}

function LineageSection({
  nodes,
  edges,
  catalogJoin,
  onOpenCatalog,
}: {
  readonly nodes: readonly MediaLineageNode[];
  readonly edges: readonly MediaLineageEdge[];
  readonly catalogJoin: MediaCatalogJoin;
  readonly onOpenCatalog?: (definitionId: string) => void;
}) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const empty = nodes.length === 0 && edges.length === 0;

  return (
    <div aria-label="Media lineage" className="grid gap-1">
      <h4 className="text-xs font-medium text-(--devtools-fg-muted)">Lineage</h4>
      {empty ? (
        <p role="status" className="text-xs text-(--devtools-fg-muted)">
          No lineage relationships were recorded for this run.
        </p>
      ) : (
        <>
          <ul className="grid gap-1 text-xs">
            {nodes.map((node) => {
              const attribution = formatMediaAttribution(node.attribution);
              return (
                <li key={`${node.kind}:${node.label}:${node.id}`}>
                  {node.kind}: {node.label}
                  {attribution ? ` · ${attribution}` : ""}
                </li>
              );
            })}
          </ul>
          {edges.length > 0 ? (
            <ul
              aria-label="Lineage relationships"
              className="grid gap-1 text-xs"
            >
              {edges.map((edge, index) => {
                const from = nodeById.get(edge.from);
                const to = nodeById.get(edge.to);
                const attribution = formatMediaAttribution(edge.attribution);
                return (
                  <li key={`${edge.type}-${edge.from}-${edge.to}-${index}`}>
                    {from?.label ?? from?.kind ?? "unknown"} —{edge.type}→{" "}
                    {to?.label ?? to?.kind ?? "unknown"}
                    {attribution ? ` · ${attribution}` : ""}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p role="status" className="text-xs text-(--devtools-fg-muted)">
              No lineage relationships were recorded for this run.
            </p>
          )}
        </>
      )}
      <CatalogJoinStatus join={catalogJoin} onOpenCatalog={onOpenCatalog} />
    </div>
  );
}

function CatalogJoinStatus({
  join,
  onOpenCatalog,
}: {
  readonly join: MediaCatalogJoin;
  readonly onOpenCatalog?: (definitionId: string) => void;
}) {
  if (join.status === "unavailable") {
    return (
      <p role="status" className="text-xs text-(--devtools-fg-muted)">
        {join.reason === "ambiguous-runtime-join"
          ? "Catalog source join unavailable — conflicting authored definition identities were recorded."
          : "Catalog source join unavailable — no authored definition identity was recorded for this run."}
      </p>
    );
  }

  if (onOpenCatalog) {
    return (
      <p className="text-xs text-(--devtools-fg-muted)">
        Catalog source{" "}
        <button
          type="button"
          className="text-(--devtools-crux) hover:underline"
          onClick={() => onOpenCatalog(join.definitionId)}
        >
          {join.label}
        </button>
      </p>
    );
  }

  return (
    <p className="text-xs text-(--devtools-fg-muted)">Catalog source {join.label}</p>
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
      <h4 className="text-xs font-medium text-(--devtools-fg-muted)">{title}</h4>
      {descriptors.length === 0 ? (
        <p className="text-xs text-(--devtools-fg-muted)">No descriptors.</p>
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
                descriptor.pageCount !== undefined
                  ? `${descriptor.pageCount} pages`
                  : undefined,
                descriptor.durationSeconds !== undefined
                  ? `${descriptor.durationSeconds}s`
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
