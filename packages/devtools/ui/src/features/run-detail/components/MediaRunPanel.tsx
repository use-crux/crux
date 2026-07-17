/**
 * Purpose-built Runs panel for multimodal operations.
 *
 * Never renders thumbnails, media players, downloads, locators, IDs, refs, or
 * filenames. Transcript text is shown only when the projection marks it present.
 * Catalog definition ids stay internal for navigation; only human labels render.
 */

import { formatMediaAttribution } from "../lib/media-run-attribution";
import type {
  MediaCatalogJoin,
  MediaLineageEdge,
  MediaLineageNode,
  MediaRunAttempt,
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
      <AttemptTimeline attempts={view.attempts} />

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

      <LineageSection
        nodes={view.lineage.nodes}
        edges={view.lineage.edges}
        catalogJoin={view.catalogJoin}
        onOpenCatalog={onOpenCatalog}
      />
    </section>
  );
}

function AttemptTimeline({
  attempts,
}: {
  readonly attempts: readonly MediaRunAttempt[];
}) {
  if (attempts.length === 0) {
    return (
      <div aria-label="Attempt timeline" className="grid gap-1">
        <h4 className="text-xs font-medium text-(--qw-fg-muted)">Attempts</h4>
        <p role="status" className="text-xs text-(--qw-fg-muted)">
          No attempts recorded.
        </p>
      </div>
    );
  }

  const byId = new Map(attempts.map((attempt) => [attempt.spanId, attempt]));

  return (
    <div aria-label="Attempt timeline" className="grid gap-1">
      <h4 className="text-xs font-medium text-(--qw-fg-muted)">Attempts</h4>
      <ol className="grid gap-1 text-xs">
        {attempts.map((attempt) => {
          const depth = attemptDepth(attempt, byId);
          const parent = attempt.parentSpanId
            ? byId.get(attempt.parentSpanId)
            : undefined;
          const paddingLeft = depth * 12;
          return (
            <li
              key={attempt.spanId}
              data-depth={depth}
              className={
                depth > 0
                  ? `border-l border-(--qw-border) ${depth >= 2 ? "depth-2" : "depth-1"}`
                  : "depth-0"
              }
              style={depth > 0 ? { paddingLeft } : undefined}
            >
              <span>
                {depth > 0 ? "↳ " : ""}
                {attempt.primitive}
                {parent ? ` (child of ${parent.primitive})` : ""}
              </span>
              <span className="text-(--qw-fg-muted)">
                {" · "}
                {[
                  attempt.provider,
                  attempt.model,
                  attempt.status,
                  attempt.durationMs !== undefined
                    ? `${attempt.durationMs}ms`
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function attemptDepth(
  attempt: MediaRunAttempt,
  byId: ReadonlyMap<string, MediaRunAttempt>,
): number {
  let depth = 0;
  let parentId = attempt.parentSpanId ?? undefined;
  const seen = new Set<string>();
  while (parentId && byId.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parentSpanId ?? undefined;
  }
  return depth;
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
      <h4 className="text-xs font-medium text-(--qw-fg-muted)">Lineage</h4>
      {empty ? (
        <p role="status" className="text-xs text-(--qw-fg-muted)">
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
            <p role="status" className="text-xs text-(--qw-fg-muted)">
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
      <p role="status" className="text-xs text-(--qw-fg-muted)">
        Catalog source join unavailable — no authored definition identity was
        recorded for this run.
      </p>
    );
  }

  if (onOpenCatalog) {
    return (
      <p className="text-xs text-(--qw-fg-muted)">
        Catalog source{" "}
        <button
          type="button"
          className="text-(--qw-crux) hover:underline"
          onClick={() => onOpenCatalog(join.definitionId)}
        >
          {join.label}
        </button>
      </p>
    );
  }

  return (
    <p className="text-xs text-(--qw-fg-muted)">Catalog source {join.label}</p>
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
