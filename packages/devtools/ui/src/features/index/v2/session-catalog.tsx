/** Purpose-built Catalog evidence for durable Session declarations. */

import type { ReactNode } from "react";
import { ThreadInspector } from "@/features/thread/components/ThreadInspector";
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

/** Render authored operation, target resolution, and stable-key evidence. */
export function IndexSessionDetail({ def }: { def: ViewDef }) {
  const select = useIndexSelect();
  if (def.kind !== "session" || def.facts?.kind !== "session") return null;
  const facts = def.facts;
  const targetLabel = facts.targetDefinitionId
    ? facts.targetDefinitionId
    : [facts.targetVariable, facts.target?.kind].filter(Boolean).join(" · ");
  const keyLabel =
    facts.key?.kind === "literal"
      ? `literal · ${facts.key.value}`
      : facts.key?.kind;
  const callLabel =
    facts.call?.kind === "ambiguous"
      ? `ambiguous · ${facts.call.reason}`
      : facts.call?.kind;
  return (
    <>
      <SectionHead
        eyebrow="Session declaration"
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
        <Row label="operation">{facts.operation}</Row>
        <Row label="target">
          {facts.targetDefinitionId ? (
            <button
              type="button"
              onClick={() => select(facts.targetDefinitionId!)}
              style={{
                all: "unset",
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              {targetLabel}
            </button>
          ) : (
            targetLabel
          )}
        </Row>
        <Row label="target binding">{facts.targetVariable}</Row>
        <Row label="key evidence">{keyLabel}</Row>
        <Row label="call shape">{callLabel}</Row>
      </div>
    </>
  );
}

/** Render the existing live Thread topology for a Thread declaration. */
export function IndexThreadInspector({ def }: { def: ViewDef }) {
  if (def.kind !== "thread") return null;
  const threadId =
    typeof def.runtimeJoin?.threadId === "string"
      ? def.runtimeJoin.threadId
      : def.id.replace(/^thread:/, "");
  return (
    <>
      <SectionHead eyebrow="Thread inspector" />
      <ThreadInspector threadId={threadId} />
    </>
  );
}
