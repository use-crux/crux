/** Purpose-built Catalog evidence for Signal providers and transport bindings. */

import type { ReactNode } from "react";
import type { ViewDef } from "./adapt";
import { useIndexSelect } from "./context";
import { Chip, SectionHead } from "./primitives";
import { T } from "./tokens";

function Row({ label, children }: { label: string; children?: ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "130px 1fr",
        gap: 12,
        padding: "6px 0",
        fontFamily: T.mono,
        fontSize: 11.5,
      }}
    >
      <span style={{ color: T.fgFaint }}>{label}</span>
      <span style={{ color: T.fg, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

function LinkableId({ id, label }: { id?: string; label?: string }) {
  const select = useIndexSelect();
  if (!id && !label) return null;
  if (!id) return <>{label}</>;
  return (
    <button
      type="button"
      onClick={() => select(id)}
      className="m-0 cursor-pointer border-0 bg-transparent p-0 [font:inherit] text-inherit underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-devtools-crux"
    >
      {label ?? id}
    </button>
  );
}

/** Render provider identity, transport kind, and Signal map lineage. */
export function IndexSignalProviderDetail({ def }: { def: ViewDef }) {
  if (def.kind !== "signal.provider" || def.facts?.kind !== "signal.provider") {
    return null;
  }
  const facts = def.facts;
  return (
    <>
      <SectionHead
        eyebrow="Signal provider"
        right={
          facts.identity ? (
            <Chip tone={facts.identity === "static" ? "ok" : "warn"}>
              {facts.identity} identity
            </Chip>
          ) : undefined
        }
      />
      <div
        style={{
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderRadius: 11,
          padding: "12px 18px",
          marginBottom: 22,
        }}
      >
        <Row label="provider id">{facts.providerId}</Row>
        <Row label="transport">{facts.transportKind}</Row>
        <Row label="transport binding">{facts.transportVariable}</Row>
        <Row label="signals">
          {facts.signalIds?.length
            ? facts.signalIds.map((signalId, index) => (
                <span key={signalId}>
                  {index > 0 ? ", " : null}
                  <LinkableId id={`signal:${signalId}`} label={signalId} />
                </span>
              ))
            : undefined}
        </Row>
        <Row label="signal bindings">
          {facts.signalVariables?.length
            ? facts.signalVariables.join(", ")
            : undefined}
        </Row>
        <Row label="onEvent">
          {facts.hasOnEvent === undefined
            ? undefined
            : facts.hasOnEvent
              ? "present"
              : "missing"}
        </Row>
      </div>
    </>
  );
}

/** Render inert transport binding identity and Signal-target lineage. */
export function IndexSignalTransportBindingDetail({ def }: { def: ViewDef }) {
  if (
    def.kind !== "signal.transportBinding" ||
    def.facts?.kind !== "signal.transportBinding"
  ) {
    return null;
  }
  const facts = def.facts;
  const configLabel =
    facts.configRef?.kind === "literal"
      ? `${facts.configRef.id}@${facts.configRef.revision}`
      : facts.configRef?.kind;
  return (
    <>
      <SectionHead
        eyebrow="Transport binding"
        right={
          facts.identity ? (
            <Chip tone={facts.identity === "static" ? "ok" : "warn"}>
              {facts.identity} identity
            </Chip>
          ) : undefined
        }
      />
      <div
        style={{
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderRadius: 11,
          padding: "12px 18px",
          marginBottom: 22,
        }}
      >
        <Row label="binding id">{facts.bindingId}</Row>
        <Row label="provider">
          <LinkableId
            id={facts.providerDefinitionId}
            label={facts.providerId ?? facts.providerVariable}
          />
        </Row>
        <Row label="adapter">{facts.adapterId}</Row>
        <Row label="config ref">{configLabel}</Row>
        <Row label="signal target">
          {facts.signalId ? (
            <LinkableId
              id={`signal:${facts.signalId}`}
              label={facts.signalId}
            />
          ) : (
            facts.target?.kind
          )}
        </Row>
        <Row label="live fields">
          {facts.liveFields?.length ? facts.liveFields.join(", ") : undefined}
        </Row>
      </div>
    </>
  );
}

/** Render a Signal definition identity. */
export function IndexSignalDetail({ def }: { def: ViewDef }) {
  if (def.kind !== "signal" || def.facts?.kind !== "signal") return null;
  return (
    <>
      <SectionHead eyebrow="Signal definition" />
      <div
        style={{
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderRadius: 11,
          padding: "12px 18px",
          marginBottom: 22,
        }}
      >
        <Row label="signal id">{def.facts.signalId}</Row>
      </div>
    </>
  );
}
