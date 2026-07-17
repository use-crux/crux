/**
 * Purpose-built Catalog section for media operations and ingest sources.
 *
 * Renders only allowlisted authored facts. Never shows thumbnails, players,
 * filenames, URLs, provider file IDs, or AssetRef URIs.
 */

import { T } from "./tokens";
import type { ViewDef } from "./adapt";
import { useIndexIndex } from "./context";
import {
  mediaCatalogBadges,
  projectIngestSourceCatalog,
  projectMediaOperationCatalog,
  type IngestSourceCatalogView,
  type MediaOperationCatalogView,
} from "./media-catalog";

/** Catalog detail section for media.operation and ingest.source definitions. */
export function IndexMedia({ def }: { readonly def: ViewDef }) {
  const idx = useIndexIndex();
  const rels = idx.relationsOf(def.id);
  const relations = [
    ...rels.outgoing.map((relation) => ({
      id: relation.id,
      type: relation.type,
      direction: "from" as const,
      otherId: relation.to,
      otherName: idx.byId(relation.to)?.name,
      otherKind: idx.byId(relation.to)?.kind,
    })),
    ...rels.incoming.map((relation) => ({
      id: relation.id,
      type: relation.type,
      direction: "to" as const,
      otherId: relation.from,
      otherName: idx.byId(relation.from)?.name,
      otherKind: idx.byId(relation.from)?.kind,
    })),
  ];
  const warningCount = idx
    .lintsForDef(def.id)
    .filter(
      (finding) =>
        finding.severity === "warning" || finding.severity === "error",
    ).length;
  const input = {
    id: def.id,
    name: def.name,
    kind: def.kind,
    fidelity: def.fidelity,
    file: def.file,
    line: def.line,
    facts: def.facts,
    warningCount,
    relations,
  };
  const view =
    projectMediaOperationCatalog(input) ?? projectIngestSourceCatalog(input);
  if (!view) return null;
  return <MediaCatalogSection view={view} />;
}

export function MediaCatalogSection({
  view,
}: {
  readonly view: MediaOperationCatalogView | IngestSourceCatalogView;
}) {
  const badges = mediaCatalogBadges(view);
  const empty =
    view.kind === "media.operation"
      ? view.operation === "unknown" && view.execution === "unknown"
      : view.sourceKind === "unknown";

  return (
    <section
      aria-label={
        view.kind === "media.operation"
          ? "Media operation architecture"
          : "Ingest source architecture"
      }
      style={{
        display: "grid",
        gap: 10,
        padding: 12,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        background: T.bgElev,
      }}
    >
      <header style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <strong style={{ color: T.fg, fontSize: 13 }}>{view.name}</strong>
        <code style={{ color: T.fgMuted, fontSize: 11 }}>{view.kind}</code>
      </header>

      {empty ? (
        <p role="status" style={{ color: T.fgMuted, fontSize: 12, margin: 0 }}>
          Authored media metadata is incomplete. Unknown support is not the same
          as unsupported capability.
        </p>
      ) : null}

      <div
        aria-label="Media badges"
        style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
      >
        {badges.map((badge) => (
          <span
            key={badge}
            style={{
              fontFamily: T.mono,
              fontSize: 10.5,
              color: badge.includes("unknown") ? T.warn : T.fgMuted,
              border: `1px solid ${T.border}`,
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            {badge}
          </span>
        ))}
      </div>

      {view.kind === "media.operation" ? (
        <dl style={{ margin: 0, display: "grid", gap: 4, fontSize: 12 }}>
          {view.adapter ? (
            <div>
              <dt style={{ color: T.fgFaint, display: "inline" }}>adapter </dt>
              <dd style={{ display: "inline", margin: 0 }}>{view.adapter}</dd>
            </div>
          ) : null}
          {view.model ? (
            <div>
              <dt style={{ color: T.fgFaint, display: "inline" }}>model </dt>
              <dd style={{ display: "inline", margin: 0 }}>{view.model}</dd>
            </div>
          ) : null}
          {Object.keys(view.authoredOptions).length > 0 ? (
            <div>
              <dt style={{ color: T.fgFaint }}>authored options</dt>
              <dd style={{ margin: 0, fontFamily: T.mono }}>
                {JSON.stringify(view.authoredOptions)}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <dl style={{ margin: 0, display: "grid", gap: 4, fontSize: 12 }}>
          {view.namespace ? (
            <div>
              <dt style={{ color: T.fgFaint, display: "inline" }}>
                namespace{" "}
              </dt>
              <dd style={{ display: "inline", margin: 0 }}>{view.namespace}</dd>
            </div>
          ) : null}
          {view.attribution.length > 0 ? (
            <div>
              <dt style={{ color: T.fgFaint, display: "inline" }}>
                attribution{" "}
              </dt>
              <dd style={{ display: "inline", margin: 0 }}>
                {view.attribution.join(", ")}
              </dd>
            </div>
          ) : null}
        </dl>
      )}

      {view.sourceFile ? (
        <p style={{ margin: 0, color: T.fgMuted, fontSize: 11 }}>
          source {view.sourceFile}
          {view.sourceLine !== undefined ? `:${view.sourceLine}` : ""}
        </p>
      ) : null}

      {view.relations.length > 0 ? (
        <ul
          aria-label="Media relations"
          style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}
        >
          {view.relations.map((relation) => (
            <li key={relation.id}>
              {relation.type} → {relation.otherName ?? relation.otherId}
              {relation.otherKind ? ` (${relation.otherKind})` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
