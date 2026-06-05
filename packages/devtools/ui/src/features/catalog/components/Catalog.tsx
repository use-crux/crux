/**
 * Catalog view — Project catalog architecture map.
 *
 * Layout matches the v4-library.jsx design:
 *  - 304px left sidebar: search input + kind filter chips + file tree
 *    grouped by `def.source.file` (real source paths, not by kind).
 *  - Detail pane: large kind icon + title + chips + actions, serif
 *    description, source meta line, source snippet card, two-column
 *    nested schemas with elbow connectors, two-column relations
 *    (incoming/outgoing), quality-impact table (drift), and diagnostics
 *    callout.
 *
 * Data comes from /api/catalog.definitions exclusively. Schemas come
 * from `def.metadata.inputSchema` / `outputSchema` (JSON Schema). We
 * walk the schema and render each property as a SchemaField — recursing
 * into nested object types and into `array.items` when items are an
 * object schema.
 */

import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useNavigation } from '@/app/navigation/useNavigation'
import { Btn, Chip, SectionHead } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { KindBadge, glyphFor } from '@/features/catalog/components/CatalogKind'
import {
  PrimarySourceCard,
  SourceRefsList,
} from '@/features/catalog/components/CatalogSourceRefs'
import {
  IntelligenceBlock,
  KindMetadataBlock,
} from '@/features/catalog/components/CatalogKindMetadata'
import { SchemaCard, schemaToFields } from '@/features/catalog/components/CatalogSchema'
import {
  AffectedDefList,
  EvidenceList,
  FixCard,
  LintMetaChips,
  LintSeverityChip,
  RuleBadge,
  lintTone,
  resolveDocsHref,
  resolveSuppressDirective,
} from '@/features/catalog/components/LintBits'
import {
  FileTreeRow,
  buildFileTree,
  buildFoldMap,
  buildModuleTree,
  foldedParentId,
  normalizeKind,
  stripRoot,
} from '@/features/catalog/components/CatalogTree'
import type {
  CatalogDiagnostic,
  CatalogLintFinding,
  JsonSchema,
  ProjectDefinition,
  ProjectDefinitionQualityDriftRow,
  ProjectRelation,
} from '@/types'

// ─── Detail pane ─────────────────────────────────────────────────────

/** Strip the leading kind prefix(es) from a relation type and convert
 * `snake_case` to a single readable verb. Always takes the last
 * dot-segment so multi-segment kinds resolve cleanly. Examples:
 *   `prompt.uses_context`     → `uses context`
 *   `eval.targets_prompt`     → `targets prompt`
 *   `flow.includes_step`      → `includes step`
 *   `flow.step.uses_agent`    → `uses agent`
 *   `memory.includes_block`   → `includes block`
 *   `composes`                → `composes` */
function relationVerb(type: string | undefined): string {
  if (!type) return ''
  const tail = type.split('.').pop() ?? type
  return tail.replace(/_/g, ' ')
}

/** Synthetic workspace-path target ids look like
 * `workspace.path:<workspace-name>:<mount-path>`. Render just the
 * mount-path portion (anything after the second `:`) so the user
 * sees the actual filesystem path, not the prefix encoding. */
function syntheticPathLabel(id: string): string {
  const stripped = id.replace(/^workspace\.path:/, '')
  const colon = stripped.indexOf(':')
  return colon >= 0 ? stripped.slice(colon + 1) : stripped
}

/** Backend emits explicit access-mode edges for data flow:
 *   `<kind>.reads_<peer>`  → read
 *   `<kind>.writes_<peer>` → write
 * Other edges (e.g. `prompt.uses_context`, `flow.includes_step`) have no
 * access semantics and return undefined so the row doesn't show a chip. */
function accessMode(type: string | undefined): 'read' | 'write' | undefined {
  if (!type) return undefined
  const tail = type.split('.').pop() ?? type
  if (tail.startsWith('reads_')) return 'read'
  if (tail.startsWith('writes_')) return 'write'
  return undefined
}

function shortHash(s: string | undefined): string | null {
  if (!s) return null
  return s.replace(/^sha256:/i, '').slice(0, 10)
}

function fmtRelative(ms: number | undefined | null): string | null {
  if (ms == null) return null
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function DefinitionDetail({
  def,
  relations,
  diagnostics,
  lintFindings,
  defsById,
  onSelect,
  projectRoot,
}: {
  def: ProjectDefinition
  relations: readonly ProjectRelation[]
  diagnostics: readonly CatalogDiagnostic[]
  lintFindings: readonly CatalogLintFinding[]
  defsById: Map<string, ProjectDefinition>
  onSelect: (id: string) => void
  projectRoot: string | undefined
}) {
  const g = glyphFor(def.kind)
  const src = def.source
  const meta = (def.metadata ?? {}) as Record<string, unknown>
  const inputSchema = meta.inputSchema as JsonSchema | undefined
  const outputSchema = meta.outputSchema as JsonSchema | undefined
  // Memory / blackboard / working primitives ship `metadata.schema` (a
  // single JSON-Schema-shaped definition). Render it the same way we
  // render prompt input schemas.
  const standaloneSchema = meta.schema as JsonSchema | undefined
  const inputFields = useMemo(() => schemaToFields(inputSchema), [inputSchema])
  const outputFields = useMemo(() => schemaToFields(outputSchema), [outputSchema])
  const standaloneFields = useMemo(() => schemaToFields(standaloneSchema), [standaloneSchema])
  const showInput = inputFields.length > 0
  const showOutput = outputFields.length > 0
  const showStandalone = standaloneFields.length > 0 && !showInput && !showOutput

  const inEdges = useMemo(
    () => relations.filter((r) => r.to === def.id).map((r) => ({ ...r, peerId: r.from, peer: defsById.get(r.from) })),
    [relations, def.id, defsById],
  )
  const outEdges = useMemo(
    () => relations.filter((r) => r.from === def.id).map((r) => ({ ...r, peerId: r.to, peer: defsById.get(r.to) })),
    [relations, def.id, defsById],
  )

  const defDiagnostics = useMemo(
    () => diagnostics.filter((d) => d.relatedDefinitionIds?.includes(def.id) ?? false),
    [diagnostics, def.id],
  )

  // Findings related to this def, split into direct (primaryDefinitionId
  // matches) and propagated (reached via outgoing dependency edges).
  // Suppressed findings are filtered out everywhere — the suppression
  // hint stays visible on the rule docs but the finding itself drops out.
  const { directLintFindings, propagatedLintFindings } = useMemo(() => {
    const direct: CatalogLintFinding[] = []
    const propagated: CatalogLintFinding[] = []
    for (const f of lintFindings) {
      if (f.suppressed) continue
      const isDirect =
        f.primaryDefinitionId === def.id ||
        (f.primaryDefinitionId == null && f.relatedDefinitionIds?.includes(def.id))
      const isPropagated =
        f.propagatedDefinitionIds?.includes(def.id) ?? false
      if (isDirect) direct.push(f)
      else if (isPropagated) propagated.push(f)
    }
    return { directLintFindings: direct, propagatedLintFindings: propagated }
  }, [lintFindings, def.id])
  const totalDefFindings = directLintFindings.length + propagatedLintFindings.length

  const driftEvals = def.quality?.drift?.evals ?? []
  const driftSuites = def.quality?.drift?.suites ?? []
  const hasDrift = driftEvals.length + driftSuites.length > 0

  return (
    <div className="px-8 pb-10 pt-6">
      {/* ── Title block ── */}
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-center gap-2.5">
          <KindBadge name={g.icon} color={g.color} size={26} />
          <span className="font-mono text-[22px] font-semibold tracking-[-0.02em]" style={{ color: 'var(--qw-fg)' }}>
            {def.name}
          </span>
          <Chip tone={g.tone} mono>
            {g.label}
          </Chip>
          {def.fidelity === 'resolved' && (
            <Chip tone="ok" dot>
              full fidelity
            </Chip>
          )}
          {def.fidelity === 'partial' && (
            <Chip tone="muted" dot>
              static · best effort
            </Chip>
          )}
          {def.fidelity === 'error' && (
            <Chip tone="danger" dot>
              error
            </Chip>
          )}
          {def.quality?.changedSinceBaseline && (
            <Chip tone="warn" dot>
              changed since baseline
            </Chip>
          )}
          {/* Tiny “N suggestions via dependencies” pill — only when the
              only findings on this def are propagated from outgoing edges.
              Matches the design's iris-soft sparkle chip in the title row. */}
          {directLintFindings.length === 0 && propagatedLintFindings.length > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-[2px] text-[11px]"
              style={{
                background: 'var(--qw-iris-soft)',
                color: 'var(--qw-iris)',
                boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--qw-iris) 30%, transparent)',
              }}
              title="Findings reached via this definition's outgoing dependencies"
            >
              <Icon name="sparkle" size={10} />
              {propagatedLintFindings.length} suggestion
              {propagatedLintFindings.length === 1 ? '' : 's'} via dependencies
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Btn
              size="xs"
              variant="primary"
              icon={<Icon name="play" size={11} />}
              disabled
              title={
                def.kind.startsWith('eval')
                  ? 'Run eval — backend wiring not yet shipped'
                  : 'Run linked evals — backend wiring not yet shipped'
              }
            >
              Run eval
            </Btn>
            <Btn
              size="xs"
              icon={<Icon name="flask" size={11} />}
              disabled
              title="Playground — backend wiring not yet shipped"
            >
              Playground
            </Btn>
            {src && (
              <Btn
                size="xs"
                icon={<Icon name="link" size={11} />}
                onClick={() => {
                  // vscode://file/<absolute>:line opens in VSCode / Cursor /
                  // Windsurf etc. `src.file` is the absolute path from the
                  // backend; stripping the project root would break the deep
                  // link, so pass it raw.
                  window.location.href = `vscode://file${src.file}:${src.line}`
                }}
                title={`Open ${src.file}:${src.line} in your editor`}
              >
                Open file
              </Btn>
            )}
          </div>
        </div>
        {def.description && (
          <p
            className="m-0 mb-2.5 max-w-[760px] text-[15px] leading-[1.55]"
            style={{
              color: 'var(--qw-fg-muted)',
              fontFamily: 'var(--qw-serif, Georgia, serif)',
            }}
          >
            {def.description}
          </p>
        )}
        <div className="flex flex-wrap gap-3.5 font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {src && (
            <span>
              <span style={{ color: 'var(--qw-fg-faint)' }}>source · </span>
              {stripRoot(src.file, projectRoot)}:{src.line}
              {src.function ? ` · ${src.function}` : ''}
            </span>
          )}
          {shortHash(def.fingerprint) && (
            <span>
              <span style={{ color: 'var(--qw-fg-faint)' }}>fingerprint · </span>
              {shortHash(def.fingerprint)}
            </span>
          )}
          {def.quality?.lastRunAt && (
            <span>
              <span style={{ color: 'var(--qw-fg-faint)' }}>last run · </span>
              {fmtRelative(def.quality.lastRunAt)}
            </span>
          )}
          {def.tags && def.tags.length > 0 && (
            <span>
              <span style={{ color: 'var(--qw-fg-faint)' }}>tags · </span>
              {def.tags.join(', ')}
            </span>
          )}
        </div>
      </div>

      {/* ── Primary source snippet + supporting sourceRefs ──
          Flat vertical stack of collapsible cards. The primary call
          site renders first; each `definition.sourceRefs` entry follows
          in array order. No section title, no role grouping — refs
          flow as a continuation of the primary call site, sharing the
          same card vocabulary. */}
      {def.sourceSnippet && (
        <PrimarySourceCard
          file={src?.file}
          snippet={def.sourceSnippet}
          projectRoot={projectRoot}
        />
      )}
      <SourceRefsList refs={def.sourceRefs} projectRoot={projectRoot} />

      {/* ── Kind-specific configuration (workspace mounts, flow steps, etc.) ── */}
      <KindMetadataBlock def={def} defsById={defsById} onSelect={onSelect} projectRoot={projectRoot} />
      <IntelligenceBlock def={def} />

      {/* ── Schemas ── */}
      {(showInput || showOutput) && (
        <>
          <SectionHead
            eyebrow="Schemas"
            right={
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {showInput && `${inputFields.length} input ${inputFields.length === 1 ? 'field' : 'fields'}`}
                {showInput && showOutput && ' · '}
                {showOutput && `${outputFields.length} output ${outputFields.length === 1 ? 'field' : 'fields'}`}
              </span>
            }
          />
          <div className="mb-6 grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
            {showInput && <SchemaCard title="Input" dotColor="var(--qw-iris)" fields={inputFields} />}
            {showOutput && <SchemaCard title="Output" dotColor="var(--qw-ok)" fields={outputFields} />}
          </div>
        </>
      )}

      {/* ── Standalone schema (memory / blackboard / working) ── */}
      {showStandalone && (
        <>
          <SectionHead
            eyebrow="Schema"
            right={
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {standaloneFields.length} field
                {standaloneFields.length === 1 ? '' : 's'}
              </span>
            }
          />
          <div className="mb-6 grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            <SchemaCard title={g.label} dotColor={g.color} fields={standaloneFields} />
          </div>
        </>
      )}

      {/* ── Relations ── */}
      {(inEdges.length > 0 || outEdges.length > 0) && (
        <>
          <SectionHead
            eyebrow="Relations"
            right={
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {inEdges.length} incoming · {outEdges.length} outgoing
              </span>
            }
          />
          <div className="mb-6 grid gap-3.5" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
            <RelationsColumn title="Used by · incoming" edges={inEdges} onSelect={onSelect} projectRoot={projectRoot} />
            <RelationsColumn
              title="Depends on · outgoing"
              edges={outEdges}
              onSelect={onSelect}
              projectRoot={projectRoot}
            />
          </div>
        </>
      )}

      {/* ── Suggestions (authored-graph lints) ──
          Per the design, this lives BETWEEN Relations and Quality impact —
          design-level observations sit alongside structural context, not
          buried under indexer diagnostics. Direct findings render first,
          followed by propagated ("via dependency") ones. */}
      {totalDefFindings > 0 && (
        <>
          <SectionHead
            eyebrow="Suggestions"
            right={
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {directLintFindings.length > 0 && `${directLintFindings.length} direct`}
                {directLintFindings.length > 0 && propagatedLintFindings.length > 0 && ' · '}
                {propagatedLintFindings.length > 0 &&
                  `${propagatedLintFindings.length} via dependencies`}
              </span>
            }
          />
          <div className="mb-6 flex flex-col gap-2.5">
            {directLintFindings.map((l) => (
              <LintFindingCallout
                key={l.id}
                finding={l}
                via={null}
                defsById={defsById}
                onSelect={onSelect}
                projectRoot={projectRoot}
              />
            ))}
            {propagatedLintFindings.map((l) => {
              // Find the propagation path that lands on this def, then
              // render the relation chain as the "reached via" label.
              const path = l.propagationPaths?.find((p) => p.toDefinitionId === def.id)
              const via = path
                ? path.relationTypes.map((rt) => rt.split('.').pop() ?? rt).join(' → ')
                : 'dependency'
              return (
                <LintFindingCallout
                  key={l.id}
                  finding={l}
                  via={via}
                  defsById={defsById}
                  onSelect={onSelect}
                  projectRoot={projectRoot}
                />
              )
            })}
          </div>
        </>
      )}

      {/* ── Quality impact ── */}
      {hasDrift && (
        <>
          <SectionHead
            eyebrow="Quality impact"
            right={
              def.quality?.changedSinceBaseline ? (
                <Chip tone="warn" dot>
                  changed since baseline
                </Chip>
              ) : undefined
            }
          />
          <div
            className="mb-6 overflow-hidden rounded-[10px]"
            style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
          >
            <div
              className="grid items-center gap-2.5 px-4 py-2 text-[10px] uppercase tracking-[0.1em]"
              style={{
                gridTemplateColumns: '24px 1fr 80px 80px 110px 90px',
                color: 'var(--qw-fg-faint)',
                borderBottom: '1px solid var(--qw-border)',
                background: 'var(--qw-bg-muted)',
              }}
            >
              <div />
              <div>check</div>
              <div style={{ textAlign: 'right' }}>pass</div>
              <div style={{ textAlign: 'right' }}>runs</div>
              <div style={{ textAlign: 'right' }}>baseline</div>
              <div style={{ textAlign: 'right' }}>drift</div>
            </div>
            {driftEvals.map((row) => (
              <DriftRow key={`eval-${row.id}`} row={row} kind="eval" />
            ))}
            {driftSuites.map((row) => (
              <DriftRow key={`suite-${row.id}`} row={row} kind="suite" />
            ))}
          </div>
        </>
      )}

      {/* ── Diagnostics (indexer health / fidelity — always last) ── */}
      {defDiagnostics.length > 0 && (
        <>
          <SectionHead
            eyebrow="Diagnostics"
            right={
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {defDiagnostics.length} {defDiagnostics.length === 1 ? 'item' : 'items'}
              </span>
            }
          />
          <div className="flex flex-col gap-2.5">
            {defDiagnostics.map((d) => (
              <DiagnosticCallout key={d.id} diag={d} projectRoot={projectRoot} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function RelationsColumn({
  title,
  edges,
  onSelect,
  projectRoot,
}: {
  title: string
  edges: readonly (ProjectRelation & { peerId: string; peer: ProjectDefinition | undefined })[]
  onSelect: (id: string) => void
  projectRoot: string | undefined
}) {
  return (
    <div
      className="rounded-[10px] px-3.5 py-3"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div
        className="mb-2.5 text-[10px] font-medium uppercase tracking-[0.14em]"
        style={{ color: 'var(--qw-fg-faint)' }}
      >
        {title}
      </div>
      <div className="flex flex-col gap-1.5">
        {edges.length === 0 && (
          <span className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
            None
          </span>
        )}
        {edges.map((e) => {
          // Synthetic `workspace.path:<workspace>:<path>` targets are
          // presentation-only — backend emits them for `workspace.mounts_path`
          // edges and they are not real definition nodes. Render them as a
          // muted folder row without a clickable target.
          const synthetic = !e.peer && e.peerId.startsWith('workspace.path:')
          const peerKind = synthetic ? 'workspace.path' : (e.peer?.kind ?? 'unknown')
          const g = synthetic
            ? { icon: 'folder' as const, tone: 'muted' as const, color: 'var(--qw-fg-muted)', label: 'path' }
            : glyphFor(peerKind)
          const name = synthetic
            ? syntheticPathLabel(e.peerId)
            : (e.peer?.name ?? e.peerId)
          const rawFile = e.peer?.source?.file ?? e.source?.file ?? ''
          const file = rawFile ? stripRoot(rawFile, projectRoot) : ''
          const clickable = !synthetic && Boolean(e.peer)
          const mode = accessMode(e.type)
          return (
            <button
              key={`${e.type}-${e.peerId}-${e.id}`}
              type="button"
              onClick={() => clickable && e.peer && onSelect(e.peer.id)}
              disabled={!clickable}
              title={`${e.type}${name ? ` · ${name}` : ''}${file ? ` · ${file}` : ''}`}
              className="flex w-full min-w-0 items-center gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors hover:bg-(--qw-bg-muted) disabled:cursor-default"
              style={{
                background: 'var(--qw-bg)',
                border: '1px solid var(--qw-border)',
              }}
            >
              <KindBadge name={g.icon} color={g.color} size={20} />
              <Chip tone={g.tone} mono className="shrink-0">
                {synthetic ? 'path' : normalizeKind(peerKind)}
              </Chip>
              {mode && (
                <Chip tone={mode === 'write' ? 'warn' : 'ok'} mono className="shrink-0">
                  {mode}
                </Chip>
              )}
              <span
                className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-medium"
                style={{ color: synthetic ? 'var(--qw-fg)' : 'var(--qw-crux)' }}
              >
                {name}
              </span>
              {file && (
                <span
                  className="hidden min-w-0 shrink truncate font-mono text-[10.5px] sm:inline-block"
                  style={{ color: 'var(--qw-fg-faint)', maxWidth: 220 }}
                >
                  {file}
                </span>
              )}
              {clickable && (
                <Icon
                  name="arrowRight"
                  size={12}
                  color="var(--qw-fg-faint)"
                  className="shrink-0"
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DriftRow({ row, kind }: { row: ProjectDefinitionQualityDriftRow; kind: 'eval' | 'suite' }) {
  const g = glyphFor(kind)
  const passPct = Math.round(row.passRate * 100)
  const passColor = passPct >= 90 ? 'var(--qw-ok)' : passPct >= 75 ? 'var(--qw-crux)' : 'var(--qw-warn)'
  const drift = row.driftPp
  const driftStr = `${drift > 0 ? '+' : ''}${drift.toFixed(0)}pp`
  const driftColor = drift < 0 ? 'var(--qw-danger)' : drift > 0 ? 'var(--qw-ok)' : 'var(--qw-fg-muted)'
  return (
    <div
      className="grid items-center gap-2.5 px-4 py-2.5 text-[12px]"
      style={{
        gridTemplateColumns: '24px 1fr 80px 80px 110px 90px',
        borderBottom: '1px solid var(--qw-border)',
      }}
    >
      <Icon name={g.icon} size={12} color={g.color} />
      <span className="font-mono text-[12.5px]">{row.id}</span>
      <span className="text-right font-mono font-semibold" style={{ color: passColor }}>
        {passPct}%
      </span>
      <span className="text-right font-mono" style={{ color: 'var(--qw-fg-muted)' }}>
        {row.runs}
      </span>
      <span className="text-right font-mono" style={{ color: 'var(--qw-crux)' }}>
        {row.baselineExperimentId}
      </span>
      <span className="text-right font-mono font-medium" style={{ color: driftColor }}>
        {driftStr}
      </span>
    </div>
  )
}

// lintTone / LintSeverityChip / RuleBadge live in `./LintBits` and are
// imported above so both surfaces (in-context + sweep view) stay in sync.

/** In-context finding card. Renders the backend's authoritative read
 *  model — no derivation, no client-side copy. Sections:
 *
 *   1. Header — severity + category/maturity/confidence chips, title,
 *      "on <target>" link, RuleBadge, "Open <target>" jump.
 *   2. Rationale (serif) — `finding.rationale` ("why it matters").
 *   3. Impact (serif) — `finding.impact` when present.
 *   4. Affected scope — chip row from `affectedDefinitionIds` (falls
 *      back to `relatedDefinitionIds`); only when the count is bigger
 *      than the single primary def already in the header.
 *   5. Evidence — `finding.evidence[]` as a compact list.
 *   6. Suggested fixes — `finding.fixes[]` as kind-aware cards.
 *   7. Footer — source · reached-via · Docs link · suppress hint.
 *      Docs prefers `finding.docsUrl`; suppress prefers
 *      `finding.suppression.directive`; both fall back to a matching
 *      entry in `finding.fixes` (see `resolveDocsHref` /
 *      `resolveSuppressDirective`). */
function LintFindingCallout({
  finding,
  via,
  defsById,
  onSelect,
  projectRoot,
}: {
  finding: CatalogLintFinding
  /** For propagated findings, the human-readable relation chain.
   *  `null` means this is a direct finding — no chain. */
  via: string | null
  defsById: Map<string, ProjectDefinition>
  onSelect: (id: string) => void
  projectRoot: string | undefined
}) {
  const c = lintTone(finding.severity)
  const targetDef = finding.primaryDefinitionId
    ? defsById.get(finding.primaryDefinitionId)
    : undefined
  const targetName = targetDef?.name ?? finding.primaryDefinitionId ?? '—'
  const targetKind = targetDef?.kind
  const docsHref = resolveDocsHref(finding)
  const directive = resolveSuppressDirective(finding)
  // Prefer `affectedDefinitionIds` for impact scope per the backend
  // handoff. Subtract the primary target so we don't repeat it.
  const affectedIds = (finding.affectedDefinitionIds ?? finding.relatedDefinitionIds).filter(
    (id) => id !== finding.primaryDefinitionId,
  )
  return (
    <div
      className="rounded-[10px]"
      style={{
        background: 'var(--qw-bg-elev)',
        border: '1px solid var(--qw-border)',
        borderLeft: `3px solid ${c.fg}`,
        padding: '14px 16px',
      }}
    >
      {/* Header row */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <LintSeverityChip severity={finding.severity} />
        <span className="text-[13.5px] font-semibold" style={{ color: 'var(--qw-fg)' }}>
          {finding.title}
        </span>
        {targetName && (
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
            · on{' '}
            <span style={{ color: 'var(--qw-crux)' }}>{targetName}</span>{' '}
            {targetKind && <span style={{ color: 'var(--qw-fg-faint)' }}>({targetKind})</span>}
          </span>
        )}
        <LintMetaChips finding={finding} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <RuleBadge ruleId={finding.ruleId} />
          {targetDef && (
            <Btn
              size="xs"
              icon={<Icon name="arrowRight" size={11} />}
              onClick={() => onSelect(targetDef.id)}
            >
              Open {targetDef.name}
            </Btn>
          )}
        </span>
      </div>

      {/* Why it matters (serif rationale) */}
      <div
        className="mb-2 max-w-[720px] text-[13px] leading-[1.55]"
        style={{
          color: 'var(--qw-fg-muted)',
          fontFamily: 'var(--qw-serif, Georgia, serif)',
        }}
      >
        {finding.rationale}
      </div>

      {/* Impact — only when the backend ships per-finding impact text */}
      {finding.impact && (
        <div
          className="mb-2 grid gap-2 rounded-[6px] px-2.5 py-2"
          style={{
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            background: 'var(--qw-bg)',
            border: '1px solid var(--qw-border)',
          }}
        >
          <span
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: c.fg }}
          >
            Impact
          </span>
          <span
            className="text-[12.5px] leading-[1.55]"
            style={{
              color: 'var(--qw-fg)',
              fontFamily: 'var(--qw-serif, Georgia, serif)',
            }}
          >
            {finding.impact}
          </span>
        </div>
      )}

      {/* Affected scope — only when there are more defs than the primary */}
      {affectedIds.length > 0 && (
        <div className="mb-2.5">
          <div
            className="mb-1 text-[9.5px] font-medium uppercase tracking-[0.14em]"
            style={{ color: 'var(--qw-fg-faint)' }}
          >
            Also affects · {affectedIds.length}
          </div>
          <AffectedDefList ids={affectedIds} defsById={defsById} onSelect={onSelect} />
        </div>
      )}

      {/* Evidence */}
      {finding.evidence.length > 0 && (
        <div className="mb-2.5">
          <div
            className="mb-1 text-[9.5px] font-medium uppercase tracking-[0.14em]"
            style={{ color: 'var(--qw-fg-faint)' }}
          >
            Evidence
          </div>
          <EvidenceList
            items={finding.evidence}
            defsById={defsById}
            onSelect={onSelect}
            projectRoot={projectRoot}
          />
        </div>
      )}

      {/* Suggested fixes — render every fix, the backend orders them */}
      {finding.fixes.length > 0 && (
        <div className="mb-2.5">
          <div
            className="mb-1 text-[9.5px] font-medium uppercase tracking-[0.14em]"
            style={{ color: 'var(--qw-fg-faint)' }}
          >
            Suggested fix{finding.fixes.length === 1 ? '' : 'es'}
          </div>
          <div className="flex flex-col gap-2">
            {finding.fixes.map((fix, i) => (
              <FixCard
                key={`${fix.kind}-${i}`}
                fix={fix}
                severity={finding.severity}
                source={finding.source}
                projectRoot={projectRoot}
              />
            ))}
          </div>
        </div>
      )}

      {/* Footer: source / reached-via / docs / suppress hint */}
      <div
        className="flex flex-wrap items-center gap-3.5 pt-1 font-mono text-[11px]"
        style={{ color: 'var(--qw-fg-muted)' }}
      >
        {finding.source && (
          <span>
            <span style={{ color: 'var(--qw-fg-faint)' }}>source · </span>
            {stripRoot(finding.source.file, projectRoot)}:{finding.source.line}
          </span>
        )}
        {via && (
          <span>
            <span style={{ color: 'var(--qw-fg-faint)' }}>reached via · </span>
            {via}
          </span>
        )}
        {docsHref && (
          <a
            href={docsHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
            style={{ color: 'var(--qw-crux)' }}
          >
            <Icon name="book" size={10} /> Docs
          </a>
        )}
        {directive && (
          <span
            className="ml-auto inline-flex items-center gap-1.5"
            style={{ color: 'var(--qw-fg-faint)' }}
            title="Paste this comment above the declaration to suppress the rule"
          >
            suppress with{' '}
            <code
              className="rounded-[3px] px-1.5 py-[1px] text-[10.5px]"
              style={{
                background: 'var(--qw-bg-muted)',
                color: 'var(--qw-fg)',
                border: '1px solid var(--qw-border)',
              }}
            >
              {directive}
            </code>
          </span>
        )}
      </div>
    </div>
  )
}


function DiagnosticCallout({ diag, projectRoot }: { diag: CatalogDiagnostic; projectRoot: string | undefined }) {
  const tone =
    diag.severity === 'error'
      ? { fg: 'var(--qw-danger)', ring: 'var(--qw-danger-soft)', bg: 'var(--qw-danger-soft)' }
      : diag.severity === 'warning'
        ? { fg: 'var(--qw-warn)', ring: 'var(--qw-warn-soft)', bg: 'var(--qw-warn-soft)' }
        : { fg: 'var(--qw-crux)', ring: 'var(--qw-crux-line)', bg: 'var(--qw-bg)' }
  return (
    <div
      className="flex items-start gap-2.5 rounded-[8px] px-3.5 py-2.5 text-[12px]"
      style={{
        background: tone.bg,
        border: `1px dashed ${tone.ring}`,
      }}
    >
      <Icon name="sparkle" size={13} color={tone.fg} className="mt-[2px]" />
      <div className="min-w-0">
        <div className="mb-0.5 font-semibold" style={{ color: tone.fg }}>
          {diag.message}
        </div>
        {diag.suggestedFix && <div style={{ color: 'var(--qw-fg-muted)' }}>{diag.suggestedFix}</div>}
        {diag.source && (
          <div className="mt-1 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {stripRoot(diag.source.file, projectRoot)}:{diag.source.line}
            {diag.code ? ` · ${diag.code}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────

export type CatalogGroupBy = 'module' | 'file'

/** Canonical list of kind filter values surfaced in the page header
 *  dropdown. `'all'` clears the filter; the remaining values are the
 *  normalized buckets `normalizeKind()` produces. Exported so
 *  `CatalogView` can build the dropdown without duplicating the list. */
export const CATALOG_KIND_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'all', label: 'All kinds' },
  { value: 'prompt', label: 'Prompts' },
  { value: 'context', label: 'Contexts' },
  { value: 'tool', label: 'Tools' },
  { value: 'agent', label: 'Agents' },
  { value: 'flow', label: 'Flows' },
  { value: 'composition', label: 'Compositions' },
  { value: 'routing', label: 'Routing' },
  { value: 'memory', label: 'Memory' },
  { value: 'workspace', label: 'Workspaces' },
  { value: 'rag', label: 'RAG' },
  { value: 'eval', label: 'Evals' },
  { value: 'suite', label: 'Suites' },
  { value: 'constraint', label: 'Constraints' },
  { value: 'guardrail', label: 'Guardrails' },
  { value: 'scorer', label: 'Scorers' },
]

interface CatalogProps {
  definitions: readonly ProjectDefinition[]
  relations?: readonly ProjectRelation[]
  diagnostics?: readonly CatalogDiagnostic[]
  lintFindings?: readonly CatalogLintFinding[]
  projectRoot?: string
  /** Group-by mode. Owned by `CatalogView` so its value can be
   *  surfaced through the page header dropdown. */
  groupBy: CatalogGroupBy
  /** Active kind filter. `'all'` = no filter. Same ownership reason. */
  kindFilter: string
}

export function Catalog({
  definitions,
  relations = [],
  diagnostics = [],
  lintFindings = [],
  projectRoot,
  groupBy,
  kindFilter,
}: CatalogProps) {
  const { nav } = useNavigation()
  const isLibraryNav = nav.view === 'library-catalog'

  // The URL slot is named `promptId` for legacy reasons, but it actually
  // carries the raw def.id. If the value contains a `:` it's already a
  // full id (e.g. `blackboard:thread:t1`, `memory:user-episodes`) and
  // we use it as-is. If not, fall back to the historical `prompt:` /
  // `context:` / `tool:` URL slots for backward-compat.
  const initialId = isLibraryNav
    ? nav.promptId
      ? nav.promptId.includes(':')
        ? nav.promptId
        : `prompt:${nav.promptId}`
      : nav.contextId
        ? nav.contextId.includes(':')
          ? nav.contextId
          : `context:${nav.contextId}`
        : nav.toolName
          ? nav.toolName.includes(':')
            ? nav.toolName
            : `tool:${nav.toolName}`
          : undefined
    : undefined

  const [selectedId, setSelectedId] = useState<string | undefined>(initialId)
  const [query, setQuery] = useState('')
  // The filtered tree can be expensive on large catalogs. Deferring the
  // query value lets the input stay responsive while the tree re-builds
  // on the next available frame.
  const deferredQuery = useDeferredValue(query)

  /** Map<defId, { sev, count }> — used to paint a severity dot on each
   *  tree row that has at least one suggestion targeting that def, and
   *  to roll up counts for folder rows. Suppressed findings are excluded;
   *  the design treats suppressed lints as out-of-inbox.
   *  Direct (primary) and propagated (transitive) targets are merged
   *  because the design dots both. */
  const findingsByDef = useMemo(() => {
    const rank: Record<CatalogLintFinding['severity'], number> = {
      info: 0,
      warning: 1,
      error: 2,
    }
    const m = new Map<string, CatalogLintFinding['severity']>()
    for (const f of lintFindings) {
      if (f.suppressed) continue
      const ids = new Set<string>([
        ...(f.relatedDefinitionIds ?? []),
        ...(f.propagatedDefinitionIds ?? []),
      ])
      if (f.primaryDefinitionId) ids.add(f.primaryDefinitionId)
      for (const id of ids) {
        const cur = m.get(id)
        if (!cur || rank[f.severity] > rank[cur]) m.set(id, f.severity)
      }
    }
    return m
  }, [lintFindings])

  const defsById = useMemo(() => {
    const m = new Map<string, ProjectDefinition>()
    for (const d of definitions) m.set(d.id, d)
    return m
  }, [definitions])

  // Non-standalone child/supporting records (flow steps, routing
  // routes/tiers/options, composition branches/stages, RAG stages, memory
  // blocks/stores) fold under their parent rather than rendering as roots.
  // They remain in `defsById`, so detail/search/relations can still open
  // them directly by id.
  const childrenByParent = useMemo(() => buildFoldMap(definitions, defsById), [definitions, defsById])
  const rootDefinitions = useMemo(
    () => definitions.filter((d) => foldedParentId(d, defsById) === undefined),
    [definitions, defsById],
  )

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    const matchesQuery = (d: ProjectDefinition) =>
      `${d.id} ${d.name} ${d.description ?? ''} ${(d.tags ?? []).join(' ')} ${d.source?.file ?? ''}`
        .toLowerCase()
        .includes(q)
    return rootDefinitions.filter((d) => {
      if (kindFilter !== 'all' && normalizeKind(d.kind) !== kindFilter) return false
      if (!q) return true
      if (matchesQuery(d)) return true
      // Surface a parent whose folded child matches, so child hits aren't
      // lost just because the child no longer has its own tree row.
      const kids = childrenByParent.get(d.id)
      return kids ? kids.some(matchesQuery) : false
    })
  }, [rootDefinitions, childrenByParent, deferredQuery, kindFilter])
  // Visual indicator when the deferred filter is still catching up
  // with the typed query — used to dim the tree slightly so the user
  // knows results haven't finished updating.
  const isFilterPending = query !== deferredQuery

  const fileTree = useMemo(() => buildFileTree(filtered, projectRoot), [filtered, projectRoot])
  const moduleTree = useMemo(() => buildModuleTree(filtered), [filtered])
  const tree = groupBy === 'file' ? fileTree : moduleTree.tree

  // Default-expand the root + first level
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (expanded.size > 0) return
    const next = new Set<string>()
    // expand top-level folders + their first file with the selected def
    for (const child of tree.children.values()) {
      next.add(child.path)
      if (child.type === 'folder') {
        for (const sub of child.children.values()) {
          if (sub.type === 'file') next.add(sub.path)
        }
      }
    }
    setExpanded(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree])

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Auto-select first definition if nothing selected
  useEffect(() => {
    if (selectedId && defsById.has(selectedId)) return
    if (filtered.length > 0) setSelectedId(filtered[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, selectedId])

  const selected = selectedId ? defsById.get(selectedId) : undefined

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: '304px 1fr' }}>
      {/* ── Sidebar ── */}
      <aside
        className="flex h-full min-h-0 flex-col overflow-hidden"
        style={{ borderRight: '1px solid var(--qw-border)', background: 'var(--qw-bg)' }}
      >
        {/* Search */}
        <div className="px-2.5 pt-3">
          <div
            className="flex items-center gap-2 rounded-[6px] px-2.5 py-[6px] text-[11.5px]"
            style={{
              border: '1px solid var(--qw-border)',
              background: 'var(--qw-bg-elev)',
              color: 'var(--qw-fg-muted)',
            }}
          >
            <Icon name="search" size={12} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a definition…"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-(--qw-fg-faint)"
              style={{ color: 'var(--qw-fg)' }}
            />
            <span className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {definitions.length}
            </span>
          </div>
        </div>

        {/* Module-mode hint when no defs have authored hierarchy.
            Per backend contract: `def.path` only comes from explicit
            authored grouping (`createPrompts`, `createContexts`, etc).
            When all defs use the flat `prompt({ id, ... })` form,
            there is no authored tree to render — that's intentional,
            not a backend gap. */}
        {groupBy === 'module' && moduleTree.hierarchical === 0 && moduleTree.flat > 0 && (
          <div
            className="mx-2.5 mt-2 rounded-[5px] px-2 py-[6px] text-[10.5px] leading-[1.45]"
            style={{
              background: 'var(--qw-bg-muted)',
              color: 'var(--qw-fg-muted)',
            }}
          >
            No authored hierarchy in this project. Group by file for a location-based tree, or use{' '}
            <span className="font-mono">createPrompts()</span> / <span className="font-mono">createContexts()</span> to
            autho nested catalogs.
          </div>
        )}

        {/* Group-by and kind filter controls have moved to the page
            header dropdowns (CatalogView → QwShell actions). Sidebar
            now only carries search + the tree itself, matching the v4
            design where the sidebar is purely navigational. */}

        {/* Tree — dimmed slightly while the deferred filter is still
            catching up to the typed query so the user sees that results
            haven't settled. */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-6 transition-opacity"
          style={{ opacity: isFilterPending ? 0.6 : 1 }}
        >
          {tree.count === 0 ? (
            <div className="px-2 py-4 text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
              {query ? `No definitions match "${query}".` : 'No definitions in the catalog yet.'}
            </div>
          ) : (
            <FileTreeRow
              folder={tree}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              selectedId={selectedId}
              onSelect={setSelectedId}
              kindFilter={kindFilter}
              findingsByDef={findingsByDef}
              childrenByParent={childrenByParent}
            />
          )}
        </div>
      </aside>

      {/* ── Detail pane ──
          Per the v4 design, the lint UI lives in-context only (Suggestions
          section on the def detail, dots in the tree). The catalog-wide
          sweep view is a separate screen at `/library/catalog/health`,
          launched from the Health button in the catalog header actions. */}
      <div className="h-full min-w-0 overflow-y-auto">
        {selected ? (
          <DefinitionDetail
            def={selected}
            relations={relations}
            diagnostics={diagnostics}
            lintFindings={lintFindings}
            defsById={defsById}
            onSelect={setSelectedId}
            projectRoot={projectRoot}
          />
        ) : (
          <div
            className="flex h-full items-center justify-center text-[13px]"
            style={{ color: 'var(--qw-fg-faint)' }}
          >
            Select a catalog entry to view details.
          </div>
        )}
      </div>
    </div>
  )
}
