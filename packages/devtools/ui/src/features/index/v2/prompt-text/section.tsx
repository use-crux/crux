import type { ReactNode } from "react";
import type { ViewDef } from "../adapt";
import { useIndexIndex } from "../context";
import { SectionHead } from "../primitives";
import { T } from "../tokens";
import { promptTextCatalogEvidence } from "./model";

function Card({
  title,
  meta,
  children,
}: {
  readonly title: string;
  readonly meta?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 9,
        background: T.bgElev,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          fontFamily: T.mono,
          fontSize: 11,
        }}
      >
        <strong style={{ color: T.fg }}>{title}</strong>
        {meta && <span style={{ color: T.fgFaint }}>{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function Detail({ children }: { readonly children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 6,
        color: T.fgMuted,
        fontFamily: T.mono,
        fontSize: 10.5,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Presents compiler-proven PromptText evidence for one Catalog definition.
 *
 * The section disappears completely when the definition has no valid
 * PromptText source, refactor, or hard-diagnostic evidence.
 */
export function PromptTextSection({ def }: { readonly def: ViewDef }) {
  const index = useIndexIndex();
  const evidence = promptTextCatalogEvidence(def, index.relPath);
  if (!evidence) return null;

  return (
    <section style={{ marginBottom: 22 }}>
      <SectionHead
        eyebrow="PromptText"
        right={
          <span style={{ color: T.crux, fontFamily: T.mono, fontSize: 10.5 }}>
            Canonical md · Markdown
          </span>
        }
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {evidence.sources.map((source) => (
          <Card
            key={source.id}
            title={source.sourceKindLabel}
            meta={`${source.role} · ${source.lifecycleLabel}`}
          >
            <Detail>
              source ref · {source.id}
              {source.joins.map((join) => (
                <div
                  key={`${join.interpolationIndex}:${join.targetSourceRefId}`}
                >
                  named-fragment join #{join.interpolationIndex} →{" "}
                  {join.targetSourceRefId}
                </div>
              ))}
            </Detail>
          </Card>
        ))}
        {evidence.refactors.map((refactor) => (
          <Card
            key={refactor.id}
            title="Refactor available"
            meta={refactor.role}
          >
            <Detail>ordinary string → md · binding {refactor.binding}</Detail>
          </Card>
        ))}
        {evidence.diagnostics.map((diagnostic) => (
          <Card
            key={diagnostic.id}
            title={diagnostic.code}
            meta={`${diagnostic.severity}${diagnostic.location ? ` · ${diagnostic.location}` : ""}`}
          >
            <Detail>
              <div>{diagnostic.message}</div>
              <div>{diagnostic.cause}</div>
              <div>source ref · {diagnostic.sourceRefId}</div>
            </Detail>
          </Card>
        ))}
      </div>
    </section>
  );
}
