import { Icon } from '@/qw/shell/Icon'
import { RowErrorBoundary } from '@/qw/shell/SectionBoundary'
import { glyphFor } from '@/features/catalog/components/CatalogKind'
import type { ProjectDefinition } from '@/types'

export interface TreeFolder {
  type: 'folder'
  name: string
  path: string
  children: Map<string, TreeFolder | TreeFile>
  count: number
}

interface TreeFile {
  type: 'file'
  name: string
  path: string
  defs: ProjectDefinition[]
}

type TreeNode = TreeFolder | TreeFile

function newFolder(name: string, path: string): TreeFolder {
  return { type: 'folder', name, path, children: new Map(), count: 0 }
}

function kindBucketLabel(normalizedKind: string): string {
  switch (normalizedKind) {
    case 'memory':
      return 'memory'
    case 'composition':
      return 'compositions'
    case 'rag':
      return 'rag'
    case 'flow':
      return 'flows'
    case 'workspace':
      return 'workspaces'
    case 'agent':
      return 'agents'
    case 'guardrail':
      return 'guardrails'
    case 'constraint':
      return 'constraints'
    case 'scorer':
      return 'scorers'
    case 'suite':
      return 'suites'
    case 'eval':
      return 'evals'
    case 'prompt':
      return 'prompts'
    case 'context':
      return 'contexts'
    case 'tool':
      return 'tools'
    default:
      return normalizedKind
  }
}

export function buildModuleTree(defs: readonly ProjectDefinition[]): {
  tree: TreeFolder
  hierarchical: number
  flat: number
} {
  const root = newFolder('', '')
  let hierarchical = 0
  let flat = 0
  for (const def of defs) {
    const segs = moduleSegments(def)
    root.count++
    if (segs.length <= 1) {
      flat++
      const bucket = kindBucketLabel(normalizeKind(def.kind))
      let leaf = root.children.get(bucket) as TreeFile | undefined
      if (!leaf || leaf.type !== 'file') {
        leaf = { type: 'file', name: bucket, path: bucket, defs: [] }
        root.children.set(bucket, leaf)
      }
      leaf.defs.push(def)
      continue
    }
    hierarchical++
    let node: TreeFolder = root
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i]
      let child = node.children.get(seg)
      if (!child || child.type !== 'folder') {
        child = newFolder(`${seg}/`, [node.path, `${seg}/`].filter(Boolean).join(''))
        node.children.set(seg, child)
      }
      child.count++
      node = child as TreeFolder
    }
    const leafName = segs[segs.length - 1]
    const leafPath = [node.path, leafName].filter(Boolean).join('')
    let leaf = node.children.get(leafName) as TreeFile | undefined
    if (!leaf || leaf.type !== 'file') {
      leaf = { type: 'file', name: leafName, path: leafPath, defs: [] }
      node.children.set(leafName, leaf)
    }
    leaf.defs.push(def)
  }
  return { tree: root, hierarchical, flat }
}

function moduleSegments(def: ProjectDefinition): string[] {
  if (def.path && def.path.length > 0) return [...def.path]
  const raw = def.name
  if (raw.includes('/')) return raw.split('/').filter(Boolean)
  if (raw.includes('.')) return raw.split('.').filter(Boolean)
  return [raw]
}

export function buildFileTree(defs: readonly ProjectDefinition[], projectRoot: string | undefined): TreeFolder {
  const root = newFolder('', '')
  for (const def of defs) {
    const rawFile = def.source?.file
    const file = rawFile ? stripRoot(rawFile, projectRoot) : undefined
    if (!file) {
      let authored = root.children.get('(authored)') as TreeFolder | undefined
      if (!authored) {
        authored = newFolder('(authored)', '(authored)')
        root.children.set('(authored)', authored)
      }
      authored.count++
      root.count++
      const kindKey = kindBucketLabel(normalizeKind(def.kind))
      let kindFile = authored.children.get(kindKey) as TreeFile | undefined
      if (!kindFile) {
        kindFile = {
          type: 'file',
          name: kindKey,
          path: `(authored)/${kindKey}`,
          defs: [],
        }
        authored.children.set(kindKey, kindFile)
      }
      kindFile.defs.push(def)
      continue
    }
    const segs = file.split('/').filter(Boolean)
    let node: TreeFolder = root
    node.count++
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i]
      let child = node.children.get(seg)
      if (!child || child.type !== 'folder') {
        child = newFolder(`${seg}/`, [node.path, `${seg}/`].filter(Boolean).join(''))
        node.children.set(seg, child)
      }
      child.count++
      node = child as TreeFolder
    }
    const fileSeg = segs[segs.length - 1]
    let leaf = node.children.get(fileSeg)
    if (!leaf || leaf.type !== 'file') {
      leaf = {
        type: 'file',
        name: fileSeg,
        path: [node.path, fileSeg].filter(Boolean).join(''),
        defs: [],
      }
      node.children.set(fileSeg, leaf)
    }
    ;(leaf as TreeFile).defs.push(def)
  }
  return root
}

function sortedChildren(folder: TreeFolder): TreeNode[] {
  const arr = Array.from(folder.children.values())
  arr.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return arr
}

type LintSeverity = 'info' | 'warning' | 'error'

const LINT_SEV_COLOR: Record<LintSeverity, { fg: string; bg: string }> = {
  info: { fg: 'var(--qw-iris)', bg: 'var(--qw-iris-soft)' },
  warning: { fg: 'var(--qw-warn)', bg: 'var(--qw-warn-soft)' },
  error: { fg: 'var(--qw-danger)', bg: 'var(--qw-danger-soft)' },
}

const LINT_SEV_RANK: Record<LintSeverity, number> = { info: 0, warning: 1, error: 2 }

/** Walk a tree node and roll up the worst lint severity + total count
 *  across every def under it. Used to render the folder-level "dot 3"
 *  badge from the design. */
function lintRollup(
  node: TreeNode,
  findingsByDef: Map<string, LintSeverity> | undefined,
): { worstSeverity: LintSeverity | null; count: number } {
  if (!findingsByDef || findingsByDef.size === 0) return { worstSeverity: null, count: 0 }
  let count = 0
  let worst: LintSeverity | null = null
  for (const def of collectDefs(node)) {
    const sev = findingsByDef.get(def.id)
    if (!sev) continue
    count++
    if (worst == null || LINT_SEV_RANK[sev] > LINT_SEV_RANK[worst]) worst = sev
  }
  return { worstSeverity: worst, count }
}

/** Tiny haloed dot — matches the design's `LintDot`. The 2px bg-tinted
 *  halo lifts the dot off any background. */
function LintDot({ severity, size = 6 }: { severity: LintSeverity; size?: number }) {
  const c = LINT_SEV_COLOR[severity]
  return (
    <span
      aria-hidden
      title={`${severity} · lint finding`}
      className="inline-block rounded-full"
      style={{
        width: size,
        height: size,
        background: c.fg,
        boxShadow: `0 0 0 2px ${c.bg}`,
        flexShrink: 0,
      }}
    />
  )
}

export function FileTreeRow({
  folder,
  depth,
  expanded,
  onToggle,
  selectedId,
  onSelect,
  kindFilter,
  findingsByDef,
}: {
  folder: TreeFolder
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  selectedId: string | undefined
  onSelect: (id: string) => void
  kindFilter: string
  /** Optional — when supplied, paints a small severity dot next to any
   *  def with at least one suggestion targeting it. */
  findingsByDef?: Map<string, LintSeverity>
}) {
  return (
    <>
      {sortedChildren(folder).map((node) => {
        if (node.type === 'folder') {
          if (kindFilter !== 'all') {
            const has = collectDefs(node).some((d) => normalizeKind(d.kind) === kindFilter)
            if (!has) return null
          }
          const open = expanded.has(node.path)
          const rollup = lintRollup(node, findingsByDef)
          return (
            <div key={node.path}>
              <button
                type="button"
                onClick={() => onToggle(node.path)}
                className="flex w-full items-center gap-1.5 rounded-[4px] py-[3px] pr-1.5 text-left font-mono text-[11.5px] font-medium hover:bg-(--qw-bg-muted)"
                style={{
                  paddingLeft: 6 + depth * 12,
                  color: 'var(--qw-fg)',
                  marginTop: depth === 0 ? 6 : 0,
                }}
              >
                <Icon name={open ? 'arrowDown' : 'arrowRight'} size={9} color="var(--qw-fg-faint)" />
                <Icon name="folder" size={12} color="var(--qw-crux)" />
                <span>{node.name}</span>
                {rollup.worstSeverity && rollup.count > 0 && (
                  <span
                    className="ml-1.5 inline-flex items-center gap-1"
                    title={`${rollup.count} suggestion${rollup.count === 1 ? '' : 's'} in this folder · worst ${rollup.worstSeverity}`}
                  >
                    <LintDot severity={rollup.worstSeverity} size={5} />
                    <span
                      className="text-[10px]"
                      style={{ color: LINT_SEV_COLOR[rollup.worstSeverity].fg }}
                    >
                      {rollup.count}
                    </span>
                  </span>
                )}
                <span className="ml-auto text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  {node.count}
                </span>
              </button>
              {open && (
                <FileTreeRow
                  folder={node}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggle={onToggle}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  kindFilter={kindFilter}
                  findingsByDef={findingsByDef}
                />
              )}
            </div>
          )
        }

        const defs = kindFilter === 'all' ? node.defs : node.defs.filter((d) => normalizeKind(d.kind) === kindFilter)
        if (defs.length === 0) return null
        const open = expanded.has(node.path)
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => onToggle(node.path)}
              className="flex w-full items-center gap-1.5 rounded-[4px] py-[3px] pr-1.5 text-left font-mono text-[11px] hover:bg-(--qw-bg-muted)"
              style={{
                paddingLeft: 6 + depth * 12,
                color: 'var(--qw-fg-muted)',
              }}
            >
              <Icon name={open ? 'arrowDown' : 'arrowRight'} size={9} color="var(--qw-fg-faint)" />
              <Icon name="doc" size={11} color="var(--qw-fg-faint)" />
              <span className="truncate">{node.name}</span>
              <span className="ml-auto text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {defs.length}
              </span>
            </button>
            {open && (
              <div style={{ marginLeft: 4 }}>
                {defs.map((def) => {
                  const g = glyphFor(def.kind)
                  const on = selectedId === def.id
                  const sev = findingsByDef?.get(def.id)
                  return (
                    <RowErrorBoundary key={def.id} rowKey={def.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(def.id)}
                      className="grid w-full items-center gap-1.5 rounded-[5px] py-[4px] pr-2 text-left transition-colors"
                      style={{
                        gridTemplateColumns: '14px 1fr auto',
                        paddingLeft: 6 + (depth + 1) * 12,
                        background: on ? 'var(--qw-crux-soft)' : 'transparent',
                        boxShadow: on ? 'inset 0 0 0 1px var(--qw-crux-line)' : 'none',
                      }}
                      title={sev ? `Has ${sev}-level suggestion` : undefined}
                    >
                      <Icon name={g.icon} size={12} color={g.color} />
                      <span
                        className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[11.5px]"
                        style={{
                          color: on ? 'var(--qw-crux)' : 'var(--qw-fg)',
                          fontWeight: on ? 600 : 450,
                        }}
                      >
                        <span className="truncate">{def.name}</span>
                        {sev && <LintDot severity={sev} size={6} />}
                      </span>
                      {def.fidelity === 'partial' && (
                        <span
                          className="rounded-[3px] px-[4px] py-[1px] font-mono text-[9px] tracking-[0.04em]"
                          style={{
                            background: 'var(--qw-bg-muted)',
                            color: 'var(--qw-fg-faint)',
                          }}
                          title="Static/best-effort definition"
                        >
                          partial
                        </span>
                      )}
                      {def.fidelity === 'error' && (
                        <span
                          className="rounded-[3px] px-[4px] py-[1px] font-mono text-[9px] tracking-[0.04em]"
                          style={{
                            background: 'var(--qw-danger-soft)',
                            color: 'var(--qw-danger)',
                          }}
                        >
                          error
                        </span>
                      )}
                    </button>
                    </RowErrorBoundary>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

function collectDefs(node: TreeNode): ProjectDefinition[] {
  if (node.type === 'file') return node.defs
  const out: ProjectDefinition[] = []
  for (const c of node.children.values()) out.push(...collectDefs(c))
  return out
}

export function normalizeKind(k: string): string {
  if (k === 'eval.prompt' || k === 'eval.flow') return 'eval'
  // Memory primitives roll up under the single "memory" filter chip.
  if (
    k === 'memory' ||
    k === 'memory.block' ||
    k === 'memory.store' ||
    k === 'working' ||
    k === 'blackboard' ||
    k === 'episodes' ||
    k === 'facts' ||
    k === 'procedures' ||
    k === 'reflections'
  ) {
    return 'memory'
  }
  if (k.startsWith('composition.')) return 'composition'
  if (k === 'flow.step') return 'flow'
  if (k.startsWith('rag.')) return 'rag'
  return k
}

export function stripRoot(file: string, root: string | undefined): string {
  if (!root) return file
  const r = root.endsWith('/') ? root : `${root}/`
  return file.startsWith(r) ? file.slice(r.length) : file
}
