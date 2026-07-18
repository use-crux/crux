/**
 * Index v2 — mid/low-tier detail sections.
 *
 * Detail sections for runtime evidence, diagnostics, health, and provenance:
 *   · IndexObservability — runtimeJoin span correlation card
 *   · IndexDiagnostics    — intelligence.diagnostics
 *   · IndexHealthSection  — lint findings (direct + via deps)
 *   · IndexProvenance     — the quiet "everything else" card
 *
 * Sections render only when their data exists.
 */

import type { ReactNode } from "react";
import { T, toneColor, type Tone } from "./tokens";
import { Icon } from "./icons";
import { Btn, Chip, SectionHead } from "./primitives";
import { kindMeta } from "./kit";
import type { ViewDef } from "./adapt";
import { useIndexIndex } from "./context";
import { useNavigation } from "@/app/navigation/useNavigation";
import { useDefinitionActivity } from "@/shared/query/useDefinitionActivity";
import { describeCatalogCoverage } from "./coverage";
import { DeliveryHealthBadge } from "@/shared/components/DeliveryHealthBadge";

function statusTone(s?: string): Tone {
  return s === "active"
    ? "ok"
    : s === "stale"
      ? "warn"
      : s === "missing"
        ? "danger"
        : "muted";
}
// ── OBSERVABILITY (exhaustive coverage: direct / contributor / runtime-unjoined / no-runtime) ──
function coverageNote(
  state: ReturnType<typeof describeCatalogCoverage>,
): string {
  switch (state.treatment) {
    case "no-runtime":
      return state.coverage.primary === "static-only"
        ? "Static/declarative — never the target or subject of a runtime primitive."
        : "No runtime evidence path is defined for this kind.";
    case "runtime-unjoined": {
      const primitives = state.coverage.runtimePrimitiveNames?.join(", ");
      return `Runtime-observed${primitives ? ` via ${primitives}` : ""}, but these records do not carry this definition’s canonical Catalog ID. Per-definition counts and View Runs are unavailable.`;
    }
    case "contributor":
      if (state.parentDerived) {
        return state.runCount > 0
          ? `Parent ran in ${state.runCount} run${state.runCount === 1 ? "" : "s"}; this definition is not independently observed.`
          : "Parent-derived evidence — this definition is not independently observed. No parent runs yet.";
      }
      if (
        state.coverage.primary === "structural-child" &&
        !state.coverage.runtimePrimitiveNames?.length
      ) {
        return state.coverage.secondary?.includes("eval-owned")
          ? "Structural child — its primary evidence lives in Eval runs; it has no independent runtime span."
          : "Structural child of its Catalog parent — it has no independent runtime span.";
      }
      return state.runCount > 0
        ? `Referenced by ${state.runCount} run${state.runCount === 1 ? "" : "s"} — never itself the subject of a run.`
        : "Referenced by an owner’s span when invoked — never itself the subject of a run. No runs yet.";
    case "eval-primary":
      return state.hasRuntimeEvidence
        ? `Eval evidence is available. This definition was also observed directly in ${state.runCount} run${state.runCount === 1 ? "" : "s"}${state.coverage.runtimePrimitiveNames ? ` (${state.coverage.runtimePrimitiveNames.join(", ")})` : ""}.`
        : "Evidence for this definition lives in Eval runs, not independent runtime spans.";
    case "direct-activity":
      return state.hasRuntimeEvidence
        ? ""
        : "No runs have referenced this definition yet.";
  }
}

export function IndexObservability({ def }: { def: ViewDef }) {
  const { navigate } = useNavigation();
  const idx = useIndexIndex();
  const { activity } = useDefinitionActivity(def.id);
  const parentDefinitionId = idx.parentOf(def.id);
  const { activity: parentActivity } =
    useDefinitionActivity(parentDefinitionId);
  const state = describeCatalogCoverage(def.kind, activity, parentActivity);
  const displayedActivity =
    state.treatment === "runtime-unjoined"
      ? undefined
      : state.parentDerived
        ? parentActivity
        : activity;
  const runsDefinitionId = state.parentDerived ? parentDefinitionId : def.id;
  const rjn = def.runtimeJoin;
  const note = coverageNote(state);
  const idKeys = [
    "promptId",
    "contextId",
    "agentId",
    "toolName",
    "retrieverId",
    "memoryId",
    "memoryStoreId",
    "ragPipelineId",
    "workspaceId",
    "routingId",
    "routeKey",
    "flowName",
    "stepLabel",
  ] as const;
  const ids = rjn
    ? idKeys.filter((k) => rjn[k]).map((k) => [k, String(rjn[k])] as const)
    : [];
  const kv = (k: string, v: ReactNode) =>
    v ? (
      <div
        style={{ display: "flex", gap: 10, fontFamily: T.mono, fontSize: 11.5 }}
      >
        <span style={{ color: T.fgFaint, minWidth: 110 }}>{k}</span>
        <span style={{ color: T.fg }}>{v}</span>
      </div>
    ) : null;
  return (
    <>
      <SectionHead
        eyebrow="Observability"
        right={
          state.runCount > 0 && runsDefinitionId ? (
            <Btn
              size="xs"
              icon="trace"
              onClick={() =>
                navigate({ view: "runs", definitionId: runsDefinitionId })
              }
            >
              View {state.runCount} runs
            </Btn>
          ) : null
        }
      />
      <div
        style={{
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderLeft: `3px solid ${state.treatment === "no-runtime" ? T.border : T.crux}`,
          borderRadius: 11,
          padding: "14px 18px",
          marginBottom: 22,
        }}
      >
        {note && (
          <div
            style={{
              fontSize: 12,
              color: T.fgMuted,
              marginBottom: rjn ? 12 : 0,
              lineHeight: 1.5,
            }}
          >
            {note}
          </div>
        )}
        {displayedActivity?.lastRun && (
          <div
            className="mb-3 flex flex-wrap items-center gap-2 text-[11px]"
            style={{ color: T.fgMuted }}
          >
            <span className="font-mono" style={{ color: T.fg }}>
              latest {displayedActivity.lastRun.status}
            </span>
            <span>·</span>
            <span>
              {new Date(
                displayedActivity.lastRun.endedAt ||
                  displayedActivity.lastRun.startedAt,
              ).toLocaleString()}
            </span>
            {displayedActivity.lastRun.durationMs > 0 && (
              <>
                <span>·</span>
                <span>
                  {displayedActivity.lastRun.durationMs.toLocaleString()}ms
                </span>
              </>
            )}
            {displayedActivity.lastRun.deliveryHealth?.status && (
              <DeliveryHealthBadge
                status={displayedActivity.lastRun.deliveryHealth.status}
              />
            )}
          </div>
        )}
        {rjn && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <Icon name="trace" size={15} color={T.crux} />
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 14,
                  fontWeight: 600,
                  color: T.fg,
                }}
              >
                {rjn.spanName || rjn.primitive}
              </span>
              {rjn.primitive && (
                <Chip tone="crux" mono>
                  {rjn.primitive}
                </Chip>
              )}
              {rjn.backend && (
                <Chip tone="muted" mono>
                  {rjn.backend}
                </Chip>
              )}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 18,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {kv("primitive", rjn.primitive)}
                {kv("backend", rjn.backend)}
                {kv("resource", rjn.resource)}
                {kv("id prefix", rjn.runtimeIdPrefix)}
                {ids.map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      display: "flex",
                      gap: 10,
                      fontFamily: T.mono,
                      fontSize: 11.5,
                    }}
                  >
                    <span style={{ color: T.fgFaint, minWidth: 110 }}>{k}</span>
                    <span style={{ color: T.fg }}>{v}</span>
                  </div>
                ))}
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {rjn.correlationAttributes && (
                  <div>
                    <div
                      style={{
                        fontFamily: T.mono,
                        fontSize: 9.5,
                        color: T.fgFaint,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        marginBottom: 6,
                      }}
                    >
                      correlation attributes
                    </div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {rjn.correlationAttributes.map((a) => (
                        <span
                          key={a}
                          style={{
                            fontFamily: T.mono,
                            fontSize: 10.5,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: T.cruxSoft,
                            color: T.crux,
                          }}
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {rjn.spanAttributes && (
                  <div>
                    <div
                      style={{
                        fontFamily: T.mono,
                        fontSize: 9.5,
                        color: T.fgFaint,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        marginBottom: 6,
                      }}
                    >
                      span attributes
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      {Object.entries(rjn.spanAttributes).map(([k, v]) => (
                        <div
                          key={k}
                          style={{ fontFamily: T.mono, fontSize: 10.5 }}
                        >
                          <span style={{ color: T.fgFaint }}>{k}=</span>
                          <span style={{ color: T.fg }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ── DIAGNOSTICS (intelligence.diagnostics) ───────────────────────────────────
export function IndexDiagnostics({ def }: { def: ViewDef }) {
  const ds = def.diagnostics;
  if (!ds || !ds.length) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      {ds.map((d, i) => {
        const c = toneColor(
          T,
          d.severity === "error"
            ? "danger"
            : d.severity === "warning"
              ? "warn"
              : "crux",
        );
        return (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "10px 14px",
              background: T.bg,
              border: `1px dashed ${c.line}`,
              borderRadius: 8,
              marginBottom: 8,
            }}
          >
            <Icon
              name="sparkle"
              size={13}
              color={c.fg}
              style={{ marginTop: 2 }}
            />
            <div>
              <span style={{ fontFamily: T.mono, fontSize: 10.5, color: c.fg }}>
                {d.code || d.severity}
              </span>
              <div style={{ fontSize: 12.5, color: T.fgMuted, marginTop: 2 }}>
                {d.message}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── HEALTH (lint) ────────────────────────────────────────────────────────────
// RETIRED. The old always-expanded stacked-card Health section was replaced by
// the verdict-bar + progressive-disclosure triage list in `health.tsx`
// (`IndexHealthSection`), wired into `detail.tsx` via `INDEX_SECTION_COMP.health`.
// See the Index health implementation handover §7.

// ── PROVENANCE (the quiet "everything else") ─────────────────────────────────
export function IndexProvenance({ def }: { def: ViewDef }) {
  const idx = useIndexIndex();
  const m = kindMeta(def.kind);
  const indexing = idx.indexing;
  const Row = ({ k, children }: { k: string; children?: ReactNode }) =>
    children != null && children !== "" ? (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr",
          gap: 12,
          padding: "6px 0",
          borderTop: `1px solid ${T.border}`,
        }}
      >
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 10.5,
            color: T.fgFaint,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {k}
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.fg }}>
          {children}
        </span>
      </div>
    ) : null;
  return (
    <>
      <SectionHead
        eyebrow="Provenance & indexing"
        right={
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.fgFaint }}>
            read-model metadata
          </span>
        }
      />
      <div
        style={{
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderRadius: 11,
          padding: "6px 18px 14px",
          marginBottom: 8,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          columnGap: 36,
        }}
      >
        <div>
          <Row k="kind">{def.kind}</Row>
          <Row k="family">{m.familyLabel}</Row>
          <Row k="status">
            <span
              style={{
                color: toneColor(T, statusTone(def.status ?? "active")).fg,
              }}
            >
              {def.status ?? "active"}
            </span>
          </Row>
          <Row k="fidelity">{def.fidelity}</Row>
          <Row k="confidence">{def.confidence}</Row>
          <Row k="fingerprint">{def.fingerprint}</Row>
          <Row k="tags">{def.tags && def.tags.join(" · ")}</Row>
        </div>
        <div>
          <Row k="source">
            {def.file}:{def.line}
            {def.raw.source?.function ? ` · ${def.raw.source.function}()` : ""}
          </Row>
          <Row k="module path">{def.path && def.path.join(".")}</Row>
          <Row k="import-safe">
            {def.sourceStatus ? String(def.sourceStatus.importSafe) : undefined}
          </Row>
          <Row k="partial reason">{def.sourceStatus?.partialReason}</Row>
          <Row k="updated">{def.updated}</Row>
          {indexing && (
            <Row k="ast index">
              {indexing.ast.status}
              {indexing.ast.indexedAt ? ` · ${indexing.ast.indexedAt}` : ""}
            </Row>
          )}
          {indexing && (
            <Row k="semantic index">
              {indexing.semantic.status}
              {indexing.semantic.indexedAt
                ? ` · ${indexing.semantic.indexedAt}`
                : ""}
            </Row>
          )}
        </div>
      </div>
    </>
  );
}
