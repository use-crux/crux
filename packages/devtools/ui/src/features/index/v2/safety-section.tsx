/** Catalog detail for authored Safety policies and operation attachments. */

import { T } from "./tokens";
import type { ViewDef } from "./adapt";
import { useIndexIndex, useIndexSelect } from "./context";
import { Chip, SectionHead } from "./primitives";
import {
  projectOperationSafetyCatalog,
  projectSafetyPolicyCatalog,
  type SafetyPolicyCatalogView,
} from "./safety-catalog";
import { safetyTargetLabel } from "@/shared/lib/safety-presentation";

/** Render indexed Safety boundaries, strategies, and completed-operation links. */
export function IndexSafety({ def }: { readonly def: ViewDef }) {
  const index = useIndexIndex();
  const relations = index.relationsOf(def.id);

  if (def.kind === "guardrail" || def.kind === "constraint") {
    const targets = relations.outgoing
      .filter((relation) => relation.type.endsWith(".applies_to"))
      .flatMap((relation) => {
        const target = index.byId(relation.to);
        return target
          ? [{ id: target.id, name: target.name, kind: target.kind }]
          : [];
      });
    const view = projectSafetyPolicyCatalog({
      id: def.id,
      name: def.name,
      kind: def.kind,
      facts: def.facts,
      targets,
    });
    return view ? <SafetyPolicySection view={view} /> : null;
  }

  if (def.kind === "media.operation") {
    const policies = relations.incoming.flatMap((relation) => {
      if (!relation.type.endsWith(".applies_to")) return [];
      const policy = index.byId(relation.from);
      if (!policy) return [];
      const view = projectSafetyPolicyCatalog({
        id: policy.id,
        name: policy.name,
        kind: policy.kind,
        facts: policy.facts,
      });
      return view ? [view] : [];
    });
    const view = projectOperationSafetyCatalog({
      id: def.id,
      name: def.name,
      kind: def.kind,
      policies,
      hasSafetyOptions: def.sourceRefs?.some(
        (reference) => reference.property === "safety",
      ),
    });
    return view ? <OperationSafetySection view={view} /> : null;
  }

  return null;
}

function SafetyPolicySection({
  view,
}: {
  readonly view: SafetyPolicyCatalogView;
}) {
  const select = useIndexSelect();
  return (
    <>
      <SectionHead eyebrow="Safety policy" />
      <section style={sectionStyle} aria-label="Safety policy architecture">
        <div style={wrapStyle}>
          <Chip tone={view.kind === "guardrail" ? "danger" : "warn"} mono>
            {view.kind}
          </Chip>
          {view.boundaries.map((boundary) => (
            <Chip key={boundary} tone="iris">
              {safetyTargetLabel(boundary)}
            </Chip>
          ))}
          {view.strategy ? (
            <Chip tone="muted" mono>
              {`${view.kind}.${view.strategy.kind}`}
            </Chip>
          ) : null}
          {view.strategy?.action ? (
            <Chip tone="warn" mono>
              {view.strategy.action}
            </Chip>
          ) : null}
        </div>

        {view.strategy?.config ? (
          <div>
            <Label>Strategy configuration</Label>
            <code style={codeStyle}>
              {JSON.stringify(view.strategy.config)}
            </code>
          </div>
        ) : null}

        {view.targets.length > 0 ? (
          <div>
            <Label>Applies to</Label>
            <div style={wrapStyle}>
              {view.targets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => select(target.id)}
                  style={targetStyle}
                >
                  {target.name} · {target.kind}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}

function OperationSafetySection({
  view,
}: {
  readonly view: NonNullable<ReturnType<typeof projectOperationSafetyCatalog>>;
}) {
  const select = useIndexSelect();
  if (view.policies.length === 0 && !view.hasSafetyOptions) return null;
  return (
    <>
      <SectionHead
        eyebrow="Safety attachments"
        right={
          view.hasSafetyOptions ? (
            <span style={statusStyle}>Safety options authored</span>
          ) : undefined
        }
      />
      <section style={sectionStyle} aria-label="Operation Safety attachments">
        {view.policies.map((policy) => (
          <button
            key={policy.id}
            type="button"
            onClick={() => select(policy.id)}
            style={policyStyle}
          >
            <span style={{ fontWeight: 600 }}>{policy.name}</span>
            <span style={wrapStyle}>
              <Chip tone={policy.kind === "guardrail" ? "danger" : "warn"} mono>
                {policy.kind}
              </Chip>
              {policy.boundaries.map((boundary) => (
                <Chip key={boundary} tone="iris">
                  {safetyTargetLabel(boundary)}
                </Chip>
              ))}
              {policy.strategy ? (
                <Chip tone="muted" mono>
                  {`${policy.kind}.${policy.strategy.kind}`}
                </Chip>
              ) : null}
              {policy.strategy?.action ? (
                <Chip tone="warn" mono>
                  {policy.strategy.action}
                </Chip>
              ) : null}
            </span>
          </button>
        ))}
      </section>
    </>
  );
}

function Label({ children }: { readonly children: string }) {
  return <div style={labelStyle}>{children}</div>;
}

const sectionStyle = {
  display: "grid",
  gap: 12,
  padding: 14,
  marginBottom: 22,
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  background: T.bgElev,
} as const;

const wrapStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 7,
} as const;

const labelStyle = {
  marginBottom: 6,
  color: T.fgFaint,
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
} as const;

const codeStyle = {
  display: "block",
  overflowWrap: "anywhere",
  color: T.fgMuted,
  fontFamily: T.mono,
  fontSize: 11,
} as const;

const targetStyle = {
  all: "unset",
  cursor: "pointer",
  color: T.fg,
  fontFamily: T.mono,
  fontSize: 11,
} as const;

const policyStyle = {
  all: "unset",
  cursor: "pointer",
  display: "grid",
  gap: 8,
  padding: 10,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.fg,
} as const;

const statusStyle = {
  color: T.ok,
  fontFamily: T.mono,
  fontSize: 11,
} as const;
