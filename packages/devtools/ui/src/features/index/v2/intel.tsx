/**
 * Index v2 — source + schema + intelligence renderers.
 *
 * Ported from the design's index-intel.jsx:
 *   · CatCode            — inline syntax highlighter
 *   · CatSchemaField     — typed field tree
 *   · CatSourceRefs      — collapsible sourceRef cards
 *   · IndexSource      — primary call-site snippet + refs
 *   · IndexContract    — input/output/args/config/schema field trees
 *   · IndexControl     — mode, ordering, retry, budget, suspension points
 *   · IndexData        — reads / writes / retrievals / artifacts
 *   · IndexDependencies— cards grouped by target kind (graph edges)
 *   · IndexConfig      — settings/config params
 *
 * Every section returns `null` when its data is absent.
 */

import { useMemo, useState, type ReactNode } from "react";
import type {
  ControlFacts,
  DataFacts,
  DependencyFacts,
  JsonSchema,
  ProjectSourceRef,
} from "@/types";
import { T, toneColor, type Tone } from "./tokens";
import { Icon } from "./icons";
import { Chip, SectionHead } from "./primitives";
import {
  FamilyDot,
  FidelityChip,
  InjectTag,
  KindGlyph,
  LintSevDot,
  kindMeta,
  lintSevMeta,
} from "./kit";
import type { ContractView, SchemaField, ViewDef } from "./adapt";
import { useIndexIndex, useIndexSelect } from "./context";

/** Compact type label for a contributed field's JSON Schema (design `_schemaType`). */
function schemaTypeLabel(s?: JsonSchema): string {
  if (!s) return "any";
  if (Array.isArray(s.type)) return s.type.join(" | ");
  if (typeof s.type === "string") return s.type;
  if (typeof (s as { label?: unknown }).label === "string")
    return (s as { label: string }).label;
  return "any";
}

// ── syntax-highlighted code block ────────────────────────────────────────────
interface Tok {
  t: string;
  v: string;
}

function tokenizeLines(src: string): Tok[][] {
  const re =
    /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(`(?:\\[\s\S]|[^\\`])*`?|'(?:\\[\s\S]|[^\\'\n])*'?|"(?:\\[\s\S]|[^\\"\n])*"?)|\b(const|let|var|function|return|if|else|export|import|from|as|async|await|new|class|interface|type|enum|extends|implements|true|false|null|undefined|default|of|in|typeof|void|never)\b|\b(\d+(?:\.\d+)?)\b|([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()|([a-zA-Z_$][a-zA-Z0-9_$]*)|([\s\S])/g;
  const flat: Tok[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) flat.push({ t: "c", v: m[1] });
    else if (m[2]) flat.push({ t: "s", v: m[2] });
    else if (m[3]) flat.push({ t: "k", v: m[3] });
    else if (m[4]) flat.push({ t: "n", v: m[4] });
    else if (m[5]) flat.push({ t: "f", v: m[5] });
    else if (m[6]) flat.push({ t: "i", v: m[6] });
    else flat.push({ t: "p", v: m[7] });
  }
  const lines: Tok[][] = [[]];
  for (const tok of flat) {
    const parts = tok.v.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p.length) lines[lines.length - 1].push({ t: tok.t, v: p });
    });
  }
  return lines;
}

export function CatCode({
  code,
  startLine = 1,
  maxHeight,
}: {
  code: string;
  startLine?: number;
  maxHeight?: number;
}) {
  const lines = useMemo(() => tokenizeLines(code || ""), [code]);
  const col: Record<string, string> = {
    c: T.fgFaint,
    s: T.ok,
    k: T.iris,
    n: T.warn,
    f: T.crux,
    i: T.fg,
    p: T.fgMuted,
  };
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        fontFamily: T.mono,
        fontSize: 11.5,
        lineHeight: 1.65,
        background: T.bg,
        color: T.fg,
        overflow: "auto",
        maxHeight,
      }}
    >
      <div
        aria-hidden
        style={{
          padding: "12px 10px 12px 14px",
          textAlign: "right",
          color: T.fgFaint,
          borderRight: `1px solid ${T.border}`,
          background: T.bgElev,
          userSelect: "none",
          fontVariantNumeric: "tabular-nums",
          minWidth: 34,
        }}
      >
        {lines.map((_, i) => (
          <div key={i}>{startLine + i}</div>
        ))}
      </div>
      <div style={{ padding: "12px 16px", minWidth: 0 }}>
        {lines.map((line, i) => (
          <div key={i} style={{ whiteSpace: "pre" }}>
            {line.length === 0
              ? " "
              : line.map((tok, j) => (
                  <span key={j} style={{ color: col[tok.t] ?? T.fg }}>
                    {tok.v}
                  </span>
                ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── schema field tree ────────────────────────────────────────────────────────
export function CatSchemaField({
  field,
  depth = 0,
  last = false,
}: {
  field: SchemaField;
  depth?: number;
  last?: boolean;
}) {
  const has = Array.isArray(field.fields) && field.fields.length > 0;
  const indent = depth * 16;
  return (
    <div style={{ position: "relative", paddingLeft: indent }}>
      {depth > 0 && (
        <span
          style={{
            position: "absolute",
            left: indent - 8,
            top: 0,
            bottom: last && !has ? 14 : 0,
            width: 1,
            background: T.border,
          }}
        />
      )}
      {depth > 0 && (
        <span
          style={{
            position: "absolute",
            left: indent - 8,
            top: 14,
            width: 6,
            height: 1,
            background: T.border,
          }}
        />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          padding: "6px 0 2px",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 12,
            fontWeight: 600,
            color: T.crux,
          }}
        >
          {field.name}
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgMuted }}>
          {field.type}
        </span>
        {field.required && (
          <span
            style={{
              fontSize: 9,
              color: T.danger,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontWeight: 600,
              padding: "1px 5px",
              background: T.dangerSoft,
              borderRadius: 3,
            }}
          >
            required
          </span>
        )}
        {!field.required && field.default !== undefined && (
          <span
            style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}
          >
            default ·{" "}
            <span style={{ color: T.fg }}>{JSON.stringify(field.default)}</span>
          </span>
        )}
      </div>
      {field.description && (
        <div
          style={{
            paddingBottom: 8,
            fontFamily: T.serif,
            fontSize: 12,
            color: T.fgMuted,
            lineHeight: 1.55,
            maxWidth: 520,
          }}
        >
          {field.description}
        </div>
      )}
      {has && (
        <div style={{ paddingBottom: 4 }}>
          {field.fields!.map((f, i) => (
            <CatSchemaField
              key={f.name}
              field={f}
              depth={depth + 1}
              last={i === field.fields!.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── sourceRefs (collapsible cards) ───────────────────────────────────────────
const INDEX_ROLE_TONE: Record<string, Tone> = {
  schema: "iris",
  prompt: "crux",
  system: "crux",
  callback: "ok",
  execute: "ok",
  handler: "ok",
  validator: "warn",
  policy: "warn",
  resolver: "warn",
  config: "muted",
  helper: "muted",
};

export function CatSourceRefs({ refs }: { refs: ProjectSourceRef[] }) {
  const idx = useIndexIndex();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {refs.map((r) => {
        const open = closed[r.id] !== true;
        const c = toneColor(T, INDEX_ROLE_TONE[r.role] ?? "muted");
        const md = r.metadata ?? {};
        const extensions = md.extensions ?? {};
        const injectionCondition =
          typeof extensions.injectionCondition === "string"
            ? extensions.injectionCondition
            : undefined;
        const injectionBranch =
          typeof extensions.branch === "string" ? extensions.branch : undefined;
        const flags = [
          md.schemaKind,
          md.nested && "nested",
          md.injected && "injected",
          md.fragment && "fragment",
          md.factoryArg && "factory-arg",
          md.toolMapContributor && "tool-map · " + md.toolMapContributor,
          md.dataAccess && "data-access",
          md.routingTarget && "routing-target",
          injectionCondition && `condition · ${injectionCondition}`,
          injectionBranch && `branch · ${injectionBranch}`,
        ].filter((x): x is string => Boolean(x));
        const refIds = md.referencedDefinitionIds ?? [];
        return (
          <div
            key={r.id}
            style={{
              background: T.bgElev,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setClosed((s) => ({ ...s, [r.id]: !s[r.id] }))}
              style={{
                all: "unset",
                cursor: "pointer",
                display: "grid",
                gridTemplateColumns: "auto auto 1fr auto auto",
                gap: 10,
                alignItems: "center",
                width: "100%",
                boxSizing: "border-box",
                padding: "9px 14px",
                background: T.bgMuted,
                borderBottom:
                  open && r.snippet ? `1px solid ${T.border}` : "none",
              }}
            >
              <Icon
                name="arrowDown"
                size={9}
                color={T.fgFaint}
                style={{
                  transform: open ? "none" : "rotate(-90deg)",
                  transition: "transform 120ms",
                }}
              />
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: T.bg,
                  color: c.fg,
                  boxShadow: `inset 0 0 0 1px ${T.border}`,
                  letterSpacing: "0.04em",
                }}
              >
                {r.role}
              </span>
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 11.5,
                  color: T.fg,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.symbol || r.property || "(anonymous)"}
                {r.property && r.symbol && (
                  <span style={{ color: T.fgFaint, fontWeight: 400 }}>
                    {" "}
                    · {r.property}
                  </span>
                )}
              </span>
              <span
                style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}
              >
                {idx.relPath(r.source.file)}
                <span style={{ color: T.crux }}>:{r.source.line}</span>
              </span>
              <FidelityChip value={r.fidelity} size="xs" />
            </button>
            {(flags.length > 0 || refIds.length > 0) && (
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  alignItems: "center",
                  padding: "6px 14px",
                  background: T.bg,
                  borderBottom:
                    open && r.snippet ? `1px solid ${T.border}` : "none",
                }}
              >
                {flags.map((fl) => (
                  <span
                    key={fl}
                    style={{
                      fontFamily: T.mono,
                      fontSize: 9.5,
                      color: T.fgMuted,
                      background: T.bgMuted,
                      padding: "1px 6px",
                      borderRadius: 3,
                      border: `1px solid ${T.border}`,
                    }}
                  >
                    {fl}
                  </span>
                ))}
                {refIds.map((id) => (
                  <span
                    key={id}
                    style={{
                      fontFamily: T.mono,
                      fontSize: 9.5,
                      color: T.crux,
                      background: T.cruxSoft,
                      padding: "1px 6px",
                      borderRadius: 3,
                    }}
                  >
                    → {id}
                  </span>
                ))}
              </div>
            )}
            {open && r.snippet && (
              <>
                {r.snippet.truncated && (
                  <div
                    style={{
                      padding: "5px 14px",
                      background: T.warnSoft,
                      color: T.warn,
                      fontFamily: T.mono,
                      fontSize: 10.5,
                      borderBottom: `1px solid ${T.border}`,
                    }}
                  >
                    truncated · only the head was statically resolvable
                  </div>
                )}
                <CatCode
                  code={r.snippet.source}
                  startLine={r.snippet.range?.startLine ?? r.source.line}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── card chrome ──────────────────────────────────────────────────────────────
function IntelCard({
  title,
  tone,
  right,
  children,
  pad = true,
}: {
  title: ReactNode;
  tone?: Tone;
  right?: ReactNode;
  children: ReactNode;
  pad?: boolean;
}) {
  const c = toneColor(T, tone ?? "muted");
  return (
    <div
      style={{
        background: T.bgElev,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 14px",
          borderBottom: `1px solid ${T.border}`,
          background: T.bgMuted,
        }}
      >
        {tone && (
          <span
            style={{ width: 7, height: 7, borderRadius: 99, background: c.fg }}
          />
        )}
        <span style={{ fontSize: 12, fontWeight: 600 }}>{title}</span>
        {right && (
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {right}
          </span>
        )}
      </div>
      <div style={{ padding: pad ? "14px 16px" : 0 }}>{children}</div>
    </div>
  );
}

// ── SOURCE ───────────────────────────────────────────────────────────────────
export function IndexSource({ def }: { def: ViewDef }) {
  if (!def.snippet && !(def.sourceRefs && def.sourceRefs.length)) return null;
  return (
    <>
      <SectionHead
        eyebrow="Source"
        right={
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>
            {def.file}
            {def.sourceRefs ? ` · +${def.sourceRefs.length} refs` : ""}
          </span>
        }
      />
      {def.snippet && (
        <div
          style={{
            background: T.bgElev,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            overflow: "hidden",
            marginBottom: def.sourceRefs ? 10 : 22,
          }}
        >
          <div
            style={{
              padding: "8px 14px",
              borderBottom: `1px solid ${T.border}`,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              fontFamily: T.mono,
              color: T.fgMuted,
              background: T.bgMuted,
            }}
          >
            <Icon name="doc" size={11} />
            <span>{def.file}</span>
            <FidelityChip value={def.fidelity} size="xs" />
            <span style={{ marginLeft: "auto", color: T.fgFaint }}>
              {def.snippet.language || "ts"} · primary call site
            </span>
          </div>
          <CatCode
            code={def.snippet.source}
            startLine={def.snippet.range?.startLine ?? def.line ?? 1}
            maxHeight={360}
          />
        </div>
      )}
      {def.sourceRefs && def.sourceRefs.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <CatSourceRefs refs={def.sourceRefs} />
        </div>
      )}
    </>
  );
}

// ── CONTRACT ─────────────────────────────────────────────────────────────────
// The effective input shape (v2): authored fields first, then fields
// contributed by injected contexts & injectables, grouped by source and tagged
// with the conditionality under which they're injected. Always-injected
// required fields stay required; conditional contributions are optional.
/**
 * In-context anchor for the injection contract rules. A finding is most
 * actionable beside the thing it's about — so the three rules that carry a
 * `finding.inputField` (`prompt.hidden_required_input`,
 * `prompt.conflicting_injected_input`, `prompt.conditional_required_input`)
 * render here, against the exact contributed field they concern, *in addition*
 * to their home in the Health sweep (every finding is still reachable there).
 */
function InlineFieldLint({ def, field }: { def: ViewDef; field: string }) {
  const idx = useIndexIndex();
  const lints = idx
    .lintsForDef(def.id)
    .filter((f) => f.inputField === field && f.primaryDefinitionId === def.id);
  if (!lints.length) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        margin: "3px 0 8px",
      }}
    >
      {lints.map((f) => {
        const m = lintSevMeta(f.severity);
        const c = toneColor(T, m.tone);
        return (
          <div
            key={f.id}
            title={f.rationale}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 7,
              padding: "5px 9px",
              borderRadius: 6,
              background: m.solid ? c.soft : T.bg,
              boxShadow: `inset 0 0 0 1px ${m.solid ? c.line : T.border}`,
            }}
          >
            <span style={{ marginTop: 2, flex: "0 0 auto" }}>
              <LintSevDot severity={f.severity} size={7} />
            </span>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontSize: 11.5, color: T.fg, lineHeight: 1.4 }}>
                {f.message}
              </span>{" "}
              <span
                style={{ fontFamily: T.mono, fontSize: 9.5, color: T.fgFaint }}
              >
                · {f.ruleId} · in Health
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CatEffectiveInput({
  contract,
  def,
}: {
  contract: ContractView;
  def: ViewDef;
}) {
  const authored = contract.inputSchema ?? [];
  const contribs = contract.inputContributions ?? [];
  const order: string[] = [];
  const bySource = new Map<
    string,
    { meta: (typeof contribs)[number]; fields: typeof contribs }
  >();
  contribs.forEach((cc) => {
    // Key by source AND conditionality/branch: one source can contribute
    // fields under different conditions (some always, some only on a branch),
    // and each group renders a single InjectTag from grp.meta — collapsing by
    // source alone would mislabel the conditionality of all but the first.
    const key = `${cc.sourceDefinitionId ?? cc.sourceName ?? "unknown"}::${cc.conditionality ?? "always"}::${cc.branch ?? ""}`;
    let grp = bySource.get(key);
    if (!grp) {
      grp = { meta: cc, fields: [] };
      bySource.set(key, grp);
      order.push(key);
    }
    grp.fields.push(cc);
  });
  const total = authored.length + contribs.length;
  return (
    <IntelCard
      title="Effective input"
      tone="iris"
      right={
        <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}>
          {total} fields · {authored.length} authored · {contribs.length}{" "}
          contributed
        </span>
      }
    >
      <p
        style={{
          margin: "0 0 14px",
          fontFamily: T.serif,
          fontSize: 12.5,
          lineHeight: 1.5,
          color: T.fgMuted,
          maxWidth: 560,
        }}
      >
        What this definition effectively expects once statically-visible
        injected contexts &amp; injectables are followed.{" "}
        <span style={{ color: T.fg }}>
          Always-injected required fields stay required; conditional
          contributions are included but optional.
        </span>
      </p>

      <div
        style={{
          fontFamily: T.mono,
          fontSize: 9.5,
          color: T.fgFaint,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          marginBottom: 4,
        }}
      >
        Authored here · {authored.length}
      </div>
      {authored.map((field, i) => (
        <div key={field.name}>
          <CatSchemaField
            field={field}
            depth={0}
            last={i === authored.length - 1}
          />
          <InlineFieldLint def={def} field={field.name} />
        </div>
      ))}

      {order.map((key) => {
        const grp = bySource.get(key)!;
        const m = grp.meta;
        const c = toneColor(T, kindMeta(m.sourceKind ?? "unknown").tone);
        return (
          <div
            key={key}
            style={{
              marginTop: 12,
              borderLeft: `2px solid ${c.line}`,
              paddingLeft: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 9.5,
                  color: T.fgFaint,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                }}
              >
                contributed by
              </span>
              <KindGlyph kind={m.sourceKind ?? "unknown"} size={18} />
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: c.fg,
                }}
              >
                {m.sourceName ?? m.sourceDefinitionId}
              </span>
              <InjectTag
                conditionality={m.conditionality}
                branch={m.branch}
                showBranch
                size="xs"
              />
              {m.via && (
                <span
                  style={{
                    fontFamily: T.mono,
                    fontSize: 9.5,
                    color: T.fgFaint,
                  }}
                >
                  via {m.via}
                </span>
              )}
            </div>
            {grp.fields.map((cf) => {
              // A field is only truly required when it's required AND always
              // injected; conditionally-contributed fields are optional from
              // the definition's standpoint (they appear only on their branch).
              const effectiveRequired =
                cf.required && (cf.conditionality ?? "always") === "always";
              return (
                <div key={cf.field} style={{ padding: "5px 0 6px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: T.mono,
                        fontSize: 12,
                        fontWeight: 600,
                        color: T.crux,
                      }}
                    >
                      {cf.field}
                    </span>
                    <span
                      style={{
                        fontFamily: T.mono,
                        fontSize: 11,
                        color: T.fgMuted,
                      }}
                    >
                      {schemaTypeLabel(cf.schema)}
                    </span>
                    {effectiveRequired ? (
                      <span
                        style={{
                          fontSize: 9,
                          color: T.danger,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          fontWeight: 600,
                          padding: "1px 5px",
                          background: T.dangerSoft,
                          borderRadius: 3,
                        }}
                      >
                        required
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: 9,
                          color: T.fgFaint,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          fontWeight: 600,
                          padding: "1px 5px",
                          background: T.bgMuted,
                          borderRadius: 3,
                        }}
                      >
                        optional
                      </span>
                    )}
                  </div>
                  {cf.description && (
                    <div
                      style={{
                        fontFamily: T.serif,
                        fontSize: 12,
                        color: T.fgMuted,
                        lineHeight: 1.5,
                        maxWidth: 520,
                        marginTop: 2,
                      }}
                    >
                      {cf.description}
                    </div>
                  )}
                  <InlineFieldLint def={def} field={cf.field} />
                </div>
              );
            })}
          </div>
        );
      })}
    </IntelCard>
  );
}

export function IndexContract({ def }: { def: ViewDef }) {
  const c = def.contract;
  if (
    !c ||
    (!c.inputSchema &&
      !c.expandedInputSchema &&
      !c.outputSchema &&
      !c.argsSchema &&
      !c.configSchema &&
      !c.schema &&
      !c.inputContributions)
  ) {
    return null;
  }
  // The effective-input view replaces the plain Input column when injected
  // sources contribute fields (or the expanded schema is genuinely wider).
  const hasEffective = Boolean(
    (c.inputContributions && c.inputContributions.length > 0) ||
    (c.expandedInputSchema &&
      c.inputSchema &&
      c.expandedInputSchema.length > c.inputSchema.length),
  );
  const pair = (c.inputSchema || hasEffective) && c.outputSchema;
  const cols: Array<{ title: string; tone: Tone; fields: SchemaField[] }> = [];
  if (c.inputSchema && !hasEffective)
    cols.push({ title: "Input", tone: "iris", fields: c.inputSchema });
  if (c.outputSchema)
    cols.push({ title: "Output", tone: "ok", fields: c.outputSchema });
  if (c.argsSchema)
    cols.push({ title: "Args", tone: "blue", fields: c.argsSchema });
  if (c.configSchema)
    cols.push({ title: "Config", tone: "muted", fields: c.configSchema });
  if (c.schema) cols.push({ title: "Schema", tone: "plum", fields: c.schema });
  const effTotal = hasEffective
    ? (c.inputSchema ?? []).length + (c.inputContributions ?? []).length
    : 0;
  const total = cols.reduce((n, s) => n + s.fields.length, 0) + effTotal;
  const meta = [
    hasEffective && "effective input",
    ...cols.map((s) => s.title.toLowerCase()),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <SectionHead
        eyebrow="Contract"
        right={
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>
            {total} fields · {meta}
          </span>
        }
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            (cols.length || hasEffective) && pair ? "1fr 1fr" : "1fr",
          gap: 16,
          marginBottom: 22,
          alignItems: "start",
        }}
      >
        {hasEffective && <CatEffectiveInput contract={c} def={def} />}
        {cols.map((s) => (
          <IntelCard
            key={s.title}
            title={s.title}
            tone={s.tone}
            right={
              <span
                style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}
              >
                {s.fields.length} fields
              </span>
            }
          >
            {s.fields.map((f, i) => (
              <CatSchemaField
                key={f.name}
                field={f}
                depth={0}
                last={i === s.fields.length - 1}
              />
            ))}
          </IntelCard>
        ))}
      </div>
    </>
  );
}

export function IndexControl({ def }: { def: ViewDef }) {
  const ctl: ControlFacts | undefined = def.control;
  if (!ctl) return null;
  const kv = (k: string, v: ReactNode) => (
    <div
      style={{ display: "flex", gap: 10, fontFamily: T.mono, fontSize: 11.5 }}
    >
      <span style={{ color: T.fgFaint, minWidth: 96 }}>{k}</span>
      <span style={{ color: T.fg }}>{v}</span>
    </div>
  );
  const hasBudget = ctl.budget && Object.keys(ctl.budget).length > 0;
  return (
    <>
      <SectionHead
        eyebrow="Control & shape"
        right={
          <span style={{ display: "flex", gap: 6 }}>
            {ctl.mode && (
              <Chip tone="blue" mono>
                {ctl.mode}
              </Chip>
            )}
            {ctl.ordering && (
              <Chip tone="muted" mono>
                {ctl.ordering}
              </Chip>
            )}
          </span>
        }
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: ctl.suspensionPoints ? "1fr 1fr" : "1fr",
          gap: 16,
          marginBottom: 22,
        }}
      >
        <IntelCard title="Execution" tone="blue">
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {ctl.mode && kv("mode", ctl.mode)}
            {ctl.ordering && kv("ordering", ctl.ordering)}
            {ctl.children && kv("children", ctl.children.length)}
            {ctl.retryPolicy &&
              kv(
                "retry",
                `${ctl.retryPolicy.maxAttempts}× · ${ctl.retryPolicy.backoff}`,
              )}
            {ctl.retryPolicy &&
              ctl.retryPolicy.nonRetryableErrors &&
              kv(
                "non-retryable",
                ctl.retryPolicy.nonRetryableErrors.join(", "),
              )}
            {ctl.fallbackPolicy &&
              kv(
                "fallback",
                `${ctl.fallbackPolicy.optionCount} options · ${ctl.fallbackPolicy.timeoutMs}ms · shouldFallback=${String(ctl.fallbackPolicy.shouldFallback)}`,
              )}
            {hasBudget &&
              kv(
                "budget",
                Object.entries(ctl.budget!)
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(" · "),
              )}
          </div>
        </IntelCard>
        {ctl.suspensionPoints && (
          <IntelCard
            title="Suspension points"
            tone="warn"
            right={
              <span
                style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}
              >
                {ctl.suspensionPoints.length}
              </span>
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ctl.suspensionPoints.map((sp) => (
                <div
                  key={sp.id}
                  style={{
                    padding: "8px 10px",
                    background: T.warnSoft,
                    borderRadius: 7,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      marginBottom: 4,
                    }}
                  >
                    <Icon name="clock" size={12} color={T.warn} />
                    <span
                      style={{ fontSize: 12, fontWeight: 600, color: T.warn }}
                    >
                      {sp.label}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: T.mono,
                      fontSize: 10.5,
                      color: T.fgMuted,
                    }}
                  >
                    signal · <span style={{ color: T.fg }}>{sp.signal}</span>
                    {sp.resumesDefinitionId && (
                      <>
                        {" "}
                        → resumes{" "}
                        <span style={{ color: T.crux }}>
                          {sp.resumesDefinitionId.split(".").pop()}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </IntelCard>
        )}
      </div>
    </>
  );
}

// ── DATA ACCESS ──────────────────────────────────────────────────────────────
export function IndexData({ def }: { def: ViewDef }) {
  const idx = useIndexIndex();
  const select = useIndexSelect();
  const d: DataFacts | undefined = def.data;
  if (!d || (!d.reads && !d.writes && !d.retrievals && !d.artifacts))
    return null;
  const opTone: Record<string, Tone> = {
    read: "ok",
    write: "danger",
    update: "warn",
    append: "iris",
    query: "crux",
    watch: "ok",
    delete: "danger",
    transaction: "danger",
  };
  const Access = ({
    items,
    title,
  }: {
    items: DataFacts["reads"];
    title: string;
  }) => (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: T.fgFaint,
          fontWeight: 500,
          marginBottom: 8,
        }}
      >
        {title} · {items!.length}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {items!.map((a, i) => {
          const target = a.targetId ? idx.byId(a.targetId) : undefined;
          const tc = toneColor(T, opTone[a.operation ?? ""] ?? "muted");
          return (
            <button
              key={i}
              type="button"
              onClick={
                target && a.targetId ? () => select(a.targetId!) : undefined
              }
              title={target ? `Open ${a.targetId}` : undefined}
              style={{
                all: "unset",
                boxSizing: "border-box",
                cursor: target ? "pointer" : "default",
                display: "grid",
                gridTemplateColumns: "60px 22px 1fr auto",
                gap: 9,
                alignItems: "center",
                padding: "6px 9px",
                background: T.bg,
                border: `1px solid ${T.border}`,
                borderRadius: 7,
              }}
            >
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 10,
                  fontWeight: 600,
                  color: tc.fg,
                  background: tc.soft,
                  padding: "1px 5px",
                  borderRadius: 3,
                  textAlign: "center",
                }}
              >
                {a.operation}
              </span>
              {target ? (
                <KindGlyph kind={target.kind} size={20} />
              ) : (
                <span style={{ width: 20 }} />
              )}
              <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fg }}>
                {a.targetId || a.targetVariable}
              </span>
              {a.key && (
                <span
                  style={{
                    fontFamily: T.mono,
                    fontSize: 10.5,
                    color: T.fgFaint,
                  }}
                >
                  {a.key}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
  return (
    <>
      <SectionHead eyebrow="Data access" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 22,
        }}
      >
        {d.reads && d.reads.length > 0 && (
          <Access items={d.reads} title="Reads" />
        )}
        {d.writes && d.writes.length > 0 && (
          <Access items={d.writes} title="Writes" />
        )}
        {d.retrievals && d.retrievals.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: T.fgFaint,
                fontWeight: 500,
                marginBottom: 8,
              }}
            >
              Retrievals · {d.retrievals.length}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {d.retrievals.map((r, i) => {
                const rid = r.retrieverId ?? r.memoryId ?? r.workspaceId;
                const target = rid ? idx.byId(rid) : undefined;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={target && rid ? () => select(rid) : undefined}
                    title={target ? `Open ${rid}` : undefined}
                    style={{
                      all: "unset",
                      boxSizing: "border-box",
                      cursor: target ? "pointer" : "default",
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "6px 9px",
                      background: T.bg,
                      border: `1px solid ${T.border}`,
                      borderRadius: 7,
                    }}
                  >
                    <KindGlyph
                      kind={target ? target.kind : "rag.retriever"}
                      size={20}
                    />
                    <span
                      style={{
                        fontFamily: T.mono,
                        fontSize: 11.5,
                        color: T.fg,
                      }}
                    >
                      {rid}
                    </span>
                    {r.topK != null && (
                      <span
                        style={{
                          fontFamily: T.mono,
                          fontSize: 10.5,
                          color: T.fgFaint,
                          marginLeft: "auto",
                        }}
                      >
                        topK · {r.topK}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {d.artifacts && d.artifacts.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: T.fgFaint,
                fontWeight: 500,
                marginBottom: 8,
              }}
            >
              Artifacts · {d.artifacts.length}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {d.artifacts.map((a, i) => (
                <div
                  key={i}
                  style={{
                    padding: "7px 10px",
                    background: T.bg,
                    border: `1px solid ${T.border}`,
                    borderRadius: 7,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "baseline", gap: 8 }}
                  >
                    <span
                      style={{
                        fontFamily: T.mono,
                        fontSize: 11.5,
                        color: T.iris,
                        fontWeight: 600,
                      }}
                    >
                      {a.name}
                    </span>
                    {a.kind && (
                      <span
                        style={{
                          fontFamily: T.mono,
                          fontSize: 10.5,
                          color: T.fgMuted,
                        }}
                      >
                        {a.kind}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── DEPENDENCIES ─────────────────────────────────────────────────────────────
const DEP_KIND: Record<string, string> = {
  prompts: "prompt",
  contexts: "context",
  injectables: "injectable",
  tools: "tool",
  agents: "agent",
  flows: "flow",
  memory: "memory",
  blackboards: "blackboard",
  workspaces: "workspace",
  stores: "memory.store",
  blocks: "memory.block",
  routers: "routing.router",
  knowledgeBases: "rag.knowledgeBase",
  ragRecipes: "rag.recipe",
  ragPipelines: "rag.pipeline",
  retrievers: "rag.retriever",
  guardrails: "guardrail",
  constraints: "constraint",
  scorers: "scorer",
};

export function IndexDependencies({ def }: { def: ViewDef }) {
  const idx = useIndexIndex();
  const select = useIndexSelect();
  const raw: DependencyFacts | undefined = def.dependencies;
  if (!raw) return null;
  const dep = raw as unknown as Record<string, string[] | undefined>;
  const groups = Object.keys(dep).filter(
    (g) => Array.isArray(dep[g]) && dep[g]!.length > 0 && DEP_KIND[g],
  );
  if (!groups.length) return null;
  const total = groups.reduce((n, g) => n + dep[g]!.length, 0);
  return (
    <>
      <SectionHead
        eyebrow="Dependencies"
        right={
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>
            {total} across {groups.length} kinds
          </span>
        }
      />
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 22 }}
      >
        {groups.map((g) => (
          <div
            key={g}
            style={{
              flex: "1 1 220px",
              minWidth: 200,
              background: T.bgElev,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                marginBottom: 10,
              }}
            >
              <FamilyDot family={kindMeta(DEP_KIND[g]).family} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "capitalize",
                  color: T.fg,
                }}
              >
                {g}
              </span>
              <span
                style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}
              >
                {dep[g]!.length}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {dep[g]!.map((id) => {
                const td = idx.byId(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={td ? () => select(id) : undefined}
                    title={td ? `Open ${id}` : undefined}
                    style={{
                      all: "unset",
                      boxSizing: "border-box",
                      cursor: td ? "pointer" : "default",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 7px",
                      background: T.bg,
                      border: `1px solid ${T.border}`,
                      borderRadius: 6,
                    }}
                  >
                    <KindGlyph kind={td ? td.kind : DEP_KIND[g]} size={19} />
                    <span
                      style={{
                        fontFamily: T.mono,
                        fontSize: 11,
                        color: T.fg,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {id}
                    </span>
                    <Icon
                      name="arrowRight"
                      size={11}
                      color={T.fgFaint}
                      style={{ marginLeft: "auto" }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── CONFIGURATION ────────────────────────────────────────────────────────────
function fmtCfg(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export function IndexConfig({ def }: { def: ViewDef }) {
  const cfg: Record<string, unknown> = {
    ...(def.config ?? def.facts?.settings ?? {}),
  };
  const keys = Object.keys(cfg);
  if (!keys.length) return null;
  const isObj = (v: unknown): v is Record<string, unknown> =>
    Boolean(v) && typeof v === "object" && !Array.isArray(v);
  const scalars = keys.filter((k) => !isObj(cfg[k]));
  const groups = keys.filter((k) => isObj(cfg[k]));
  const Param = ({ k, v }: { k: string; v: unknown }) => {
    const isBool = typeof v === "boolean";
    const isNull = v === null;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          padding: "6px 0",
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fgMuted }}>
          {k}
        </span>
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 11.5,
            fontWeight: 500,
            color: isNull ? T.fgFaint : isBool ? (v ? T.ok : T.fgMuted) : T.fg,
            textAlign: "right",
          }}
        >
          {fmtCfg(v)}
        </span>
      </div>
    );
  };
  return (
    <>
      <SectionHead
        eyebrow="Configuration"
        right={
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>
            {keys.length} params
          </span>
        }
      />
      <div
        style={{
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderRadius: 11,
          padding: "6px 18px 12px",
          marginBottom: 22,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            columnGap: 36,
          }}
        >
          {scalars.map((k) => (
            <Param key={k} k={k} v={cfg[k]} />
          ))}
        </div>
        {groups.map((gk) => (
          <div key={gk} style={{ marginTop: 12 }}>
            <div
              style={{
                fontFamily: T.mono,
                fontSize: 9.5,
                color: T.fgFaint,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              {gk}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                columnGap: 36,
              }}
            >
              {Object.entries(cfg[gk] as Record<string, unknown>).map(
                ([k, v]) => (
                  <Param key={k} k={k} v={v} />
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
