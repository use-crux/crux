import type { ChipTone } from '@/qw/shell/primitives'
import type { IconName } from '@/qw/shell/nav'
import type { MemoryInspection, MemoryStoreType } from '@/types'

interface TypeMeta {
  icon: IconName
  tone: ChipTone
  color: string
  label: string
}

const TYPE_META: Record<MemoryStoreType, TypeMeta> = {
  working: { icon: 'brain', tone: 'crux', color: 'var(--qw-crux)', label: 'working' },
  episodic: { icon: 'book', tone: 'iris', color: 'var(--qw-iris)', label: 'episodic' },
  semantic: { icon: 'db', tone: 'ok', color: 'var(--qw-ok)', label: 'semantic' },
  blackboard: { icon: 'grid', tone: 'warn', color: 'var(--qw-warn)', label: 'blackboard' },
}

export const typeMeta = (t: MemoryStoreType | string): TypeMeta =>
  TYPE_META[t as MemoryStoreType] ?? TYPE_META.working

export function healthTone(h: string | undefined): ChipTone {
  if (h === 'healthy') return 'ok'
  if (h === 'errored') return 'danger'
  if (h === 'stale') return 'warn'
  return 'muted'
}

export function fmtTime(ms: number | undefined | null): string | null {
  if (ms == null) return null
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

export function fmtRelative(ms: number | undefined | null): string | null {
  if (ms == null) return null
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function fmtDuration(ms: number | undefined | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${Math.round(s - m * 60)}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m - h * 60}m`
}

export function fmtCount(n: number | undefined | null): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

export function shortBreadcrumbId(id: string): string {
  if (id.length <= 36) return id
  const colon = id.indexOf(':')
  if (colon > 0 && colon < 32) {
    const head = id.slice(0, colon + 1)
    return `${head}${id.slice(colon + 1, colon + 9)}…`
  }
  return `${id.slice(0, 28)}…`
}

export function shortTrace(id: string | undefined | null): string | null {
  if (!id) return null
  if (id.length <= 10) return id
  return `${id.slice(0, 4)}…${id.slice(-2)}`
}

export function fmtValue(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Cheap structural type-name derived from a JSON value for the `TYPE` column. */
export function liveTypeName(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

export interface LiveField {
  name: string
  value: unknown
  ty: string
  writtenAt?: number
}

/**
 * Pull a field map out of a live-bridge `inspection`.
 *
 * The Convex CruxStore peer ships *one* entry per memory resource whose
 * `value.content` is a JSON-string of the actual field map (the document the
 * runtime persists). We parse it back into typed rows so the existing
 * field/value table can render live data.
 *
 * Returns `null` when the inspection is not OK, has no entries, or none of
 * the entries decode into a field-map object. Callers fall back to projected
 * fields in that case.
 */
export function parseLiveFields(inspection: MemoryInspection | undefined): readonly LiveField[] | null {
  if (!inspection || inspection.status !== 'ok') return null
  const entries = inspection.entries ?? []
  if (entries.length === 0) return null

  const rows: LiveField[] = []
  for (const entry of entries) {
    const obj = decodeEntryObject(entry.value)
    if (!obj) continue
    const writtenAt = typeof obj.updatedAt === 'number' ? obj.updatedAt : undefined
    const content = decodeContent(obj.content)
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      for (const [k, v] of Object.entries(content as Record<string, unknown>)) {
        rows.push({ name: k, value: v, ty: liveTypeName(v), writtenAt })
      }
    } else {
      // Fall back: single key=value row using the entry key.
      rows.push({ name: entry.key, value: obj.content ?? entry.value, ty: liveTypeName(obj.content ?? entry.value), writtenAt })
    }
  }
  if (rows.length === 0) return null
  // Stable alpha order matches projection rendering.
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return rows
}

function decodeEntryObject(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function decodeContent(content: unknown): unknown {
  if (typeof content !== 'string') return content
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}

export function scoreTone(score: number | undefined | null): string {
  if (score == null) return 'var(--qw-fg-faint)'
  if (score >= 0.85) return 'var(--qw-ok)'
  if (score >= 0.7) return 'var(--qw-crux)'
  return 'var(--qw-warn)'
}
