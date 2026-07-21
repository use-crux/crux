/** Embedding capability summary rendered inside RAG consumer hero cards. */

import { T } from "./tokens";
import type { ViewDef } from "./adapt";
import { useIndexIndex } from "./context";
import {
  projectEmbeddingConsumerCatalog,
  shortEmbeddingDigest,
} from "./embedding-catalog";

/** Render the resolved embedding dependencies of a retriever or knowledge base. */
export function EmbeddingCatalogHero({ def }: { readonly def: ViewDef }) {
  const index = useIndexIndex();
  const dependencies = index
    .relationsOf(def.id)
    .outgoing.map((relation) => {
      const embedding = index.byId(relation.to);
      return embedding
        ? {
            relationType: relation.type,
            id: embedding.id,
            name: embedding.name,
            facts: embedding.facts,
          }
        : undefined;
    })
    .filter((value): value is NonNullable<typeof value> => value !== undefined);
  const view = projectEmbeddingConsumerCatalog({
    id: def.id,
    name: def.name,
    kind: def.kind,
    dependencies,
  });
  if (!view) {
    return (
      <p style={{ margin: 0, fontSize: 11.5, color: T.fgMuted }}>
        Embedding configuration is not statically resolved.
      </p>
    );
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {view.embeddings.map((embedding) => (
        <div
          key={`${embedding.embeddingKind}:${embedding.id}`}
          style={{
            display: "grid",
            gap: 8,
            padding: "10px 12px",
            border: `1px solid ${T.border}`,
            borderRadius: 9,
            background: T.bgElev,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 7,
            }}
          >
            <strong style={{ fontSize: 12.5, color: T.fg }}>
              {embedding.name}
            </strong>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}>
              {embedding.embeddingKind}
            </span>
            {embedding.modalities.map((modality) => (
              <span
                key={modality}
                style={{
                  padding: "2px 7px",
                  border: `1px solid ${T.border}`,
                  borderRadius: 999,
                  fontFamily: T.mono,
                  fontSize: 10,
                  color: T.fgMuted,
                }}
              >
                {modality}
              </span>
            ))}
          </div>
          {embedding.space ? (
            <div
              aria-label="Embedding space"
              style={{
                display: "flex",
                alignItems: "baseline",
                flexWrap: "wrap",
                gap: 7,
                fontFamily: T.mono,
                fontSize: 10.5,
              }}
            >
              <span style={{ color: T.fgFaint }}>Embedding space</span>
              <span style={{ color: T.fg }}>{embedding.space.name}</span>
              <span style={{ color: T.fgMuted }}>
                {new Intl.NumberFormat("en-US").format(
                  embedding.space.dimensions,
                )}{" "}
                dimensions
              </span>
              {embedding.space.digest ? (
                <code style={{ color: T.fgMuted }}>
                  {shortEmbeddingDigest(embedding.space.digest)}
                </code>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
