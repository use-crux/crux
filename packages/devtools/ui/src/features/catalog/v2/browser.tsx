/**
 * Catalog v2 — Library / Catalog master–detail browser (content only).
 *
 * Ported from the design's catalog-browser.jsx. A compact finder rail
 * (search · grouping axis · family filter · grouped list) on the left and
 * the full-width CatalogDetail on the right. The graph + expand overlays
 * cover the content area. The page chrome (title / subtitle / header
 * actions) lives in CatalogView's QwShell, so this renders the inner
 * surface only; `selected` and `graphOpen` are controlled by the parent so
 * the header's Graph button can drive the overlay.
 */

import { useState } from 'react'
import { T, toneColor, type Tone } from './tokens'
import { Icon } from './icons'
import { Btn } from './primitives'
import { CAT_FAMILY_ORDER, KindGlyph, familyMeta, kindMeta, type FamilyId } from './kit'
import type { CatalogIndex, ViewDef } from './adapt'
import { CatalogSelectProvider, useCatalogIndex } from './context'
import { CatalogDetail } from './detail'
import { CatalogGraph } from './graph'

interface Axis {
  id: string
  label: string
}
const CAT_AXES: Axis[] = [
  { id: 'family', label: 'Family' },
  { id: 'kind', label: 'Kind' },
  { id: 'file', label: 'File' },
  { id: 'module', label: 'Module' },
  { id: 'quality', label: 'Quality' },
  { id: 'health', label: 'Health' },
]

function dirOf(file?: string): string {
  if (!file) return '—'
  const p = file.split('/')
  p.pop()
  return p.join('/') || '/'
}

interface Group {
  key: string
  label: string
  tone: Tone
  mono?: boolean
  items: ViewDef[]
}

function buildGroups(idx: CatalogIndex, defs: ViewDef[], axis: string): Group[] {
  const groups: Group[] = []
  const index: Record<string, Group> = {}
  const ensure = (key: string, meta: Omit<Group, 'key' | 'items'>) => {
    if (!index[key]) {
      index[key] = { key, items: [], ...meta }
      groups.push(index[key])
    }
    return index[key]
  }
  if (axis === 'family') {
    CAT_FAMILY_ORDER.forEach((fam) => ensure(fam, { label: familyMeta(fam).label, tone: familyMeta(fam).tone }))
    defs.forEach((d) => {
      const fam = (kindMeta(d.kind).family ?? 'other') as FamilyId | 'other'
      ensure(fam, { label: familyMeta(fam as FamilyId).label, tone: familyMeta(fam as FamilyId).tone }).items.push(d)
    })
    return groups.filter((g) => g.items.length)
  }
  if (axis === 'kind') {
    defs.forEach((d) => {
      const m = kindMeta(d.kind)
      ensure(d.kind, { label: m.label, tone: m.tone }).items.push(d)
    })
    return groups.sort((a, b) => b.items.length - a.items.length)
  }
  if (axis === 'file') {
    defs.forEach((d) => ensure(dirOf(d.file), { label: dirOf(d.file), tone: 'muted', mono: true }).items.push(d))
    return groups.sort((a, b) => a.label.localeCompare(b.label))
  }
  if (axis === 'module') {
    defs.forEach((d) => {
      const k = (d.path && d.path[0]) || '·root'
      ensure(k, { label: k, tone: 'muted', mono: true }).items.push(d)
    })
    return groups.sort((a, b) => a.label.localeCompare(b.label))
  }
  if (axis === 'quality') {
    const meta: Record<string, { label: string; tone: Tone }> = {
      covered: { label: 'Covered by evals', tone: 'ok' },
      runs: { label: 'Runs · no baseline', tone: 'warn' },
      none: { label: 'No coverage', tone: 'muted' },
    }
    ;(['covered', 'runs', 'none'] as const).forEach((k) => ensure(k, meta[k]))
    defs.forEach((d) => {
      const q = d.quality ?? {}
      const k = (q.evalIds && q.evalIds.length) || (q.suiteIds && q.suiteIds.length) ? 'covered' : q.runCount ? 'runs' : 'none'
      ensure(k, meta[k]).items.push(d)
    })
    return groups.filter((g) => g.items.length)
  }
  if (axis === 'health') {
    const meta: Record<string, { label: string; tone: Tone }> = {
      warning: { label: 'Warnings', tone: 'warn' },
      info: { label: 'Suggestions', tone: 'iris' },
      clean: { label: 'Clean', tone: 'ok' },
    }
    ;(['warning', 'info', 'clean'] as const).forEach((k) => ensure(k, meta[k]))
    defs.forEach((d) => {
      const ls = idx.lintsForDef(d.id).filter((f) => f.primaryDefinitionId === d.id)
      const k = ls.some((f) => f.severity === 'warning' || f.severity === 'error') ? 'warning' : ls.length ? 'info' : 'clean'
      ensure(k, meta[k]).items.push(d)
    })
    return groups.filter((g) => g.items.length)
  }
  return groups
}

// ── compact rail row ─────────────────────────────────────────────────────────
function CatRailRow({ def, selected, onClick }: { def: ViewDef; selected: boolean; onClick: () => void }) {
  const idx = useCatalogIndex()
  const m = kindMeta(def.kind)
  const c = toneColor(T, m.tone)
  const children = idx.childrenOf(def.id)
  const lints = idx.lintsForDef(def.id).filter((f) => f.primaryDefinitionId === def.id)
  const maxSev: Tone | null = lints.some((l) => l.severity === 'warning' || l.severity === 'error') ? 'warn' : lints.length ? 'iris' : null
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        boxSizing: 'border-box',
        width: '100%',
        display: 'grid',
        gridTemplateColumns: '22px 1fr auto',
        gap: 8,
        alignItems: 'center',
        padding: '5px 8px 5px 6px',
        borderRadius: 6,
        background: selected ? c.soft : 'transparent',
        boxShadow: selected ? `inset 0 0 0 1px ${c.line}` : 'none',
      }}
    >
      <KindGlyph kind={def.kind} size={22} />
      <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: selected ? 600 : 450, color: selected ? c.fg : T.fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def.name}</span>
        {children.length > 0 && <span style={{ fontFamily: T.mono, fontSize: 9, color: T.fgFaint, flexShrink: 0 }}>+{children.length}</span>}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {def.fidelity !== 'resolved' && <span style={{ width: 5, height: 5, borderRadius: 99, background: def.fidelity === 'error' ? T.danger : T.warn }} title={def.fidelity} />}
        {maxSev && <span style={{ width: 5, height: 5, borderRadius: 99, background: toneColor(T, maxSev).fg }} />}
      </span>
    </button>
  )
}

// ── the screen (content only) ────────────────────────────────────────────────
export function CatalogBrowser({
  selected,
  onSelect,
  graphOpen,
  onGraphClose,
}: {
  selected: string | null
  onSelect: (id: string) => void
  graphOpen: boolean
  onGraphClose: () => void
}) {
  const idx = useCatalogIndex()
  const [axis, setAxis] = useState('family')
  const [query, setQuery] = useState('')
  const [fams, setFams] = useState<Set<FamilyId>>(() => new Set(CAT_FAMILY_ORDER))
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState(false)
  const allOn = fams.size === CAT_FAMILY_ORDER.length

  const defs = idx.standalone.filter((d) => {
    const fam = kindMeta(d.kind).family
    if (fam && !fams.has(fam)) return false
    if (query && !`${d.name} ${d.kind} ${kindMeta(d.kind).label}`.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })
  const groups = buildGroups(idx, defs, axis)
  const sel = selected ? idx.byId(selected) : undefined
  const famCounts = idx.countByFamily()

  return (
    <CatalogSelectProvider select={onSelect}>
    <div style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative' }}>
      {/* ── finder rail ─────────────────────────────── */}
      <aside style={{ width: 290, flex: '0 0 290px', borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', minHeight: 0, background: T.bg }}>
        <div style={{ padding: '12px 12px 10px', borderBottom: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', gap: 9, flex: '0 0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: `1px solid ${T.border}`, borderRadius: 7, background: T.bgElev }}>
            <Icon name="search" size={13} color={T.fgFaint} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a definition…"
              style={{ all: 'unset', flex: 1, fontFamily: T.sans, fontSize: 12, color: T.fg }}
            />
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}>{defs.length}</span>
          </div>
          {/* axis */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint, marginRight: 2 }}>group</span>
            {CAT_AXES.map((a) => {
              const on = axis === a.id
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAxis(a.id)}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    padding: '3px 8px',
                    borderRadius: 5,
                    fontFamily: T.sans,
                    fontSize: 11,
                    fontWeight: on ? 600 : 450,
                    color: on ? T.crux : T.fgMuted,
                    background: on ? T.cruxSoft : 'transparent',
                    boxShadow: on ? `inset 0 0 0 1px ${T.cruxLine}` : 'none',
                  }}
                >
                  {a.label}
                </button>
              )
            })}
          </div>
          {/* family filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setFams(allOn ? new Set() : new Set(CAT_FAMILY_ORDER))}
              style={{ all: 'unset', cursor: 'pointer', fontFamily: T.mono, fontSize: 10, color: T.fgFaint, marginRight: 2 }}
            >
              {allOn ? 'none' : 'all'}
            </button>
            {CAT_FAMILY_ORDER.map((fam) => {
              const on = fams.has(fam)
              const c = toneColor(T, familyMeta(fam).tone)
              return (
                <button
                  key={fam}
                  type="button"
                  title={familyMeta(fam).label}
                  onClick={() =>
                    setFams((s) => {
                      const n = new Set(s)
                      if (n.has(fam)) n.delete(fam)
                      else n.add(fam)
                      return n
                    })
                  }
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '2px 7px 2px 6px',
                    borderRadius: 99,
                    fontSize: 10.5,
                    fontFamily: T.sans,
                    color: on ? c.fg : T.fgFaint,
                    background: on ? c.soft : 'transparent',
                    boxShadow: `inset 0 0 0 1px ${on ? c.line : T.border}`,
                    opacity: on ? 1 : 0.55,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: on ? c.fg : T.fgFaint }} />
                  {familyMeta(fam).label}
                  <span style={{ fontFamily: T.mono, fontSize: 9, opacity: 0.8 }}>{famCounts[fam] ?? 0}</span>
                </button>
              )
            })}
          </div>
        </div>
        {/* list */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 8px 24px' }}>
          {groups.map((g) => {
            const gc = toneColor(T, g.tone)
            const isCol = collapsed[axis + g.key]
            return (
              <div key={g.key} style={{ marginBottom: 4 }}>
                <button
                  type="button"
                  onClick={() => setCollapsed((s) => ({ ...s, [axis + g.key]: !s[axis + g.key] }))}
                  style={{ all: 'unset', cursor: 'pointer', width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px 5px' }}
                >
                  <Icon name="arrowDown" size={8} color={T.fgFaint} style={{ transform: isCol ? 'rotate(-90deg)' : 'none', transition: 'transform 120ms' }} />
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: gc.fg }} />
                  <span style={{ fontFamily: g.mono ? T.mono : T.sans, fontSize: 11.5, fontWeight: 600, color: T.fg }}>{g.label}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 10, color: T.fgFaint }}>{g.items.length}</span>
                </button>
                {!isCol && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {g.items.map((d) => (
                      <CatRailRow key={d.id} def={d} selected={selected === d.id} onClick={() => onSelect(d.id)} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </aside>

      {/* ── detail ──────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <CatalogDetail def={sel} onExpand={() => setExpanded(true)} />
      </div>

      {/* ── graph overlay ───────────────────────────── */}
      {graphOpen && (
        <div style={{ position: 'absolute', inset: 0, background: T.bg, zIndex: 30, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: `1px solid ${T.border}`, background: T.bgElev }}>
            <Icon name="grid" size={14} color={T.crux} />
            <span style={{ fontFamily: T.sans, fontSize: 12.5, fontWeight: 600 }}>Architecture graph</span>
            <span style={{ fontSize: 11, color: T.fgFaint }}>click a node to inspect · drag to pan · scroll to zoom</span>
            <Btn size="sm" icon="x" variant="ghost" style={{ marginLeft: 'auto' }} onClick={onGraphClose}>
              Close
            </Btn>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <CatalogGraph
              initialSelected={selected}
              onOpenDetail={(id) => {
                onSelect(id)
                onGraphClose()
              }}
            />
          </div>
        </div>
      )}

      {/* ── expand overlay ──────────────────────────── */}
      {expanded && sel && (
        <div style={{ position: 'absolute', inset: 0, background: T.bg, zIndex: 30, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: `1px solid ${T.border}`, background: T.bgElev }}>
            <KindGlyph kind={sel.kind} size={22} />
            <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 600 }}>{sel.name}</span>
            <span style={{ fontSize: 11, color: T.fgFaint }}>fullscreen detail</span>
            <Btn size="sm" icon="x" variant="ghost" style={{ marginLeft: 'auto' }} onClick={() => setExpanded(false)}>
              Close
            </Btn>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <CatalogDetail def={sel} />
          </div>
        </div>
      )}
    </div>
    </CatalogSelectProvider>
  )
}
