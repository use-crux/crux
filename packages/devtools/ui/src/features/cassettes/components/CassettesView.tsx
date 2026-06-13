/**
 * Cassettes — executor-boundary replay recordings. Staleness (>90 days) is
 * the key affordance; entries carry recorded model output and aren't exposed.
 */

import { useMemo, useState } from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { useQualityCassettesSuspense } from '@/shared/hooks/useQualityApi'
import { useToast } from '@/qw/shell/useToast'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'

function timeAgo(iso: string | undefined): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (!ts) return ''
  const diff = Date.now() - ts
  const d = Math.floor(diff / (24 * 60 * 60 * 1000))
  if (d < 1) {
    const h = Math.floor(diff / (60 * 60 * 1000))
    if (h < 1) {
      const m = Math.floor(diff / 60_000)
      return m < 1 ? 'just now' : `${m}m ago`
    }
    return `${h}h ago`
  }
  if (d < 30) return `${d}d ago`
  const months = Math.floor(d / 30)
  return `${months}mo ago`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type Tab = 'all' | 'fresh' | 'stale'

export function CassettesView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const [tab, setTab] = useState<Tab>('all')
  const { toast } = useToast()
  // Suspends on first paint — caught by the top-level App Suspense.
  const qualityCassettes = useQualityCassettesSuspense()

  const counts = useMemo(() => {
    let stale = 0
    for (const c of qualityCassettes) if (c.stale) stale++
    return { stale, fresh: qualityCassettes.length - stale }
  }, [qualityCassettes])

  const items = useMemo(() => {
    if (tab === 'all') return qualityCassettes
    if (tab === 'stale') return qualityCassettes.filter((c) => c.stale)
    return qualityCassettes.filter((c) => !c.stale)
  }, [qualityCassettes, tab])

  const totalEntries = qualityCassettes.reduce((s, c) => s + c.entryCount, 0)

  return (
    <QwShell
      activeView="cassettes"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Loop / Cassettes"
      title="Replay cassettes"
      subtitle={`${qualityCassettes.length} recordings · ${totalEntries} entries${counts.stale > 0 ? ` · ${counts.stale} stale` : ''}`}
      connected={connected}
      tabs={[
        { label: 'All', active: tab === 'all', count: qualityCassettes.length, onClick: () => setTab('all') },
        { label: 'Fresh', active: tab === 'fresh', count: counts.fresh, onClick: () => setTab('fresh') },
        {
          label: 'Stale',
          active: tab === 'stale',
          count: counts.stale,
          iconName: 'alert',
          onClick: () => setTab('stale'),
        },
      ]}
    >
      <div className="flex flex-col gap-3 px-8 pb-10 pt-5">
        {items.length === 0 && (
          <div
            className="rounded-[10px] px-6 py-12 text-center text-[13px]"
            style={{
              background: 'var(--qw-bg-elev)',
              border: '1px dashed var(--qw-border)',
              color: 'var(--qw-fg-muted)',
            }}
          >
            No cassettes. Record one with{' '}
            <code className="font-mono">crux quality run --replay record-new</code>.
          </div>
        )}
        {items.map((c) => {
          const stripe = c.stale ? 'var(--qw-warn)' : 'var(--qw-border)'
          return (
            <div
              key={c.path}
              className="overflow-hidden rounded-[10px]"
              style={{
                background: 'var(--qw-bg-elev)',
                border: '1px solid var(--qw-border)',
                borderLeft: `3px solid ${stripe}`,
              }}
            >
              <div className="grid items-center gap-5 px-[18px] py-3.5" style={{ gridTemplateColumns: '260px 1fr 220px 200px' }}>
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <Icon name="cassette" size={14} color="var(--qw-crux)" />
                    <span className="font-mono text-[14px] font-semibold">{c.name}</span>
                  </div>
                  {c.stale ? (
                    <Chip tone="warn" dot>
                      stale
                    </Chip>
                  ) : (
                    <Chip tone="ok" dot>
                      fresh
                    </Chip>
                  )}
                </div>
                <div className="flex gap-5 font-mono text-[12px]">
                  <Stat label="Entries" value={c.entryCount.toString()} />
                  <Stat label="Size" value={formatBytes(c.sizeBytes)} color="var(--qw-fg-muted)" />
                  <Stat label="SDK" value={c.sdkVersion || '—'} color="var(--qw-fg-muted)" />
                </div>
                <div>
                  <div
                    className="mb-1 text-[10px] font-mono uppercase tracking-[0.08em]"
                    style={{ color: 'var(--qw-fg-faint)' }}
                  >
                    Models
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {c.models.map((m) => (
                      <Chip key={m} tone="iris" mono>
                        {m}
                      </Chip>
                    ))}
                    {c.models.length === 0 && (
                      <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                        none
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                    {c.recordedAt ? `recorded ${timeAgo(c.recordedAt)}` : ''}
                  </span>
                  <Btn
                    size="xs"
                    icon={<Icon name="loop" size={11} />}
                    onClick={() =>
                      toast({
                        kind: 'info',
                        title: c.stale ? 'Cassette is stale' : 'Re-record cassette',
                        message: `Re-record with \`crux quality run --replay refresh\` (or record-new) to refresh ${c.name}.`,
                      })
                    }
                  >
                    Re-record
                  </Btn>
                </div>
              </div>
              {c.stale && (
                <div
                  className="flex items-center gap-3 px-[18px] py-2.5 text-[12px]"
                  style={{
                    background: 'var(--qw-warn-soft)',
                    borderTop: '1px solid var(--qw-border)',
                    color: 'var(--qw-warn)',
                  }}
                >
                  <Icon name="alert" size={13} color="var(--qw-warn)" />
                  <span className="font-semibold">Older than the 90-day replay window</span>
                  <span className="font-mono opacity-80" style={{ color: 'var(--qw-fg-muted)' }}>
                    recorded {timeAgo(c.recordedAt)} — re-record to refresh
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </QwShell>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--qw-fg-faint)' }}>
        {label}
      </div>
      <div className="mt-0.5 text-[18px] font-semibold" style={{ color: color ?? 'var(--qw-fg)' }}>
        {value}
      </div>
    </div>
  )
}
