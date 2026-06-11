/**
 * Cassettes — deterministic replay fixture status.
 */

import { useMemo, useState } from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip, type ChipTone } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { useCassetteIssueMutation } from '@/shared/hooks/useQualityMutations'
import { useQualityCassettesSuspense } from '@/shared/hooks/useQualityApi'
import { useToast } from '@/qw/shell/useToast'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'

const STATUS_TONE: Record<string, ChipTone> = {
  matching: 'ok',
  mismatch: 'danger',
  missing: 'danger',
  stale: 'warn',
}

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

type Tab = 'all' | 'matching' | 'mismatch' | 'missing'

export function CassettesView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const [tab, setTab] = useState<Tab>('all')
  const logIssue = useCassetteIssueMutation()
  const { toast } = useToast()
  // Suspends on first paint — caught by the top-level App Suspense
  // (or any parent SectionBoundary). Once cached, WS / background
  // refetches don't re-suspend.
  const qualityCassettes = useQualityCassettesSuspense()

  const counts = useMemo(() => {
    const c = { matching: 0, mismatch: 0, missing: 0 }
    for (const cs of qualityCassettes) {
      const s = cs.status
      if (s === 'matching') c.matching++
      else if (s === 'mismatch') c.mismatch++
      else if (s === 'missing') c.missing++
    }
    return c
  }, [qualityCassettes])

  const items = useMemo(() => {
    if (tab === 'all') return qualityCassettes
    return qualityCassettes.filter((c) => c.status === tab)
  }, [qualityCassettes, tab])

  const totalEntries = qualityCassettes.reduce((s, c) => s + c.entryCount, 0)
  const totalMismatch = qualityCassettes.reduce((s, c) => s + (c.mismatchCount ?? 0), 0)

  return (
    <QwShell
      activeView="cassettes"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Loop / Cassettes"
      title="Replay cassettes"
      subtitle={`${qualityCassettes.length} recordings · ${totalEntries} entries · ${totalMismatch} mismatches`}
      connected={connected}
      actions={
        <>
          <Btn
            icon={<Icon name="filter" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Status filter',
                message: 'Use the tab strip below to filter by matching / mismatch / missing.',
              })
            }
          >
            All status
          </Btn>
          <Btn
            variant="primary"
            icon={<Icon name="loop" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Record cassette',
                message: 'Run your suite with CASSETTE_MODE=record, or `crux quality cassettes record`.',
              })
            }
          >
            Record session
          </Btn>
        </>
      }
      tabs={[
        { label: 'All', active: tab === 'all', count: qualityCassettes.length, onClick: () => setTab('all') },
        { label: 'Matching', active: tab === 'matching', count: counts.matching, onClick: () => setTab('matching') },
        {
          label: 'Mismatch',
          active: tab === 'mismatch',
          count: counts.mismatch,
          iconName: 'x',
          onClick: () => setTab('mismatch'),
        },
        {
          label: 'Missing',
          active: tab === 'missing',
          count: counts.missing,
          iconName: 'alert',
          onClick: () => setTab('missing'),
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
            No cassettes. Record a session by replaying a deterministic suite.
          </div>
        )}
        {items.map((c) => {
          const tone = STATUS_TONE[c.status] ?? 'muted'
          const stripe =
            c.status === 'matching'
              ? 'var(--qw-border)'
              : c.status === 'mismatch' || c.status === 'missing'
                ? 'var(--qw-danger)'
                : 'var(--qw-warn)'
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
              <div
                className="grid items-center gap-5 px-[18px] py-3.5"
                style={{ gridTemplateColumns: '220px 1fr 240px 280px' }}
              >
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <Icon name="cassette" size={14} color="var(--qw-crux)" />
                    <span className="font-mono text-[14px] font-semibold">{c.path.split('/').slice(-1)[0]}</span>
                    {c.mode && (
                      <Chip tone="muted" mono>
                        {c.mode}
                      </Chip>
                    )}
                  </div>
                  <Chip tone={tone} dot>
                    {c.status}
                  </Chip>
                </div>
                <div className="flex gap-5 font-mono text-[12px]">
                  <Stat label="Entries" value={c.entryCount.toString()} />
                  <Stat
                    label="Mismatches"
                    value={String(c.mismatchCount ?? 0)}
                    color={(c.mismatchCount ?? 0) > 0 ? 'var(--qw-danger)' : 'var(--qw-fg-muted)'}
                  />
                  <Stat
                    label="Coverage"
                    value={`${Math.round((c.coverage ?? 0) * 100)}%`}
                    color={
                      c.coverage >= 0.99 ? 'var(--qw-ok)' : c.coverage >= 0.9 ? 'var(--qw-crux)' : 'var(--qw-warn)'
                    }
                  />
                </div>
                <div>
                  <div
                    className="mb-1 text-[10px] font-mono uppercase tracking-[0.08em]"
                    style={{ color: 'var(--qw-fg-faint)' }}
                  >
                    Matchers
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(c.matchers ?? []).map((m) => (
                      <Chip key={m} tone="iris" mono>
                        {m}
                      </Chip>
                    ))}
                    {(c.matchers ?? []).length === 0 && (
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
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Btn
                      size="xs"
                      icon={<Icon name="trace" size={11} />}
                      onClick={() =>
                        toast({
                          kind: 'info',
                          title: 'Open cassette',
                          message: `${c.path} — file browser/replay diff UI is next.`,
                        })
                      }
                    >
                      Open
                    </Btn>
                    <Btn
                      size="xs"
                      icon={<Icon name="loop" size={11} />}
                      onClick={() =>
                        logIssue({
                          path: c.path,
                          status: 'mismatch',
                          reason: 'User requested re-record',
                        })
                      }
                    >
                      {c.status === 'matching' ? 'Refresh' : 'Re-record'}
                    </Btn>
                    {c.status === 'mismatch' && (
                      <Btn
                        size="xs"
                        variant="soft"
                        icon={<Icon name="diff" size={11} />}
                        onClick={() =>
                          toast({
                            kind: 'info',
                            title: 'Mismatch diff',
                            message: `${c.path} · ${c.mismatchCount ?? 0} mismatches — viewer coming next, mismatch list visible in the row.`,
                          })
                        }
                      >
                        View diff
                      </Btn>
                    )}
                  </div>
                </div>
              </div>
              {c.status === 'mismatch' && (
                <div
                  className="flex items-center gap-3 px-[18px] py-2.5 text-[12px]"
                  style={{
                    background: 'var(--qw-danger-soft)',
                    borderTop: '1px solid var(--qw-border)',
                    color: 'var(--qw-danger)',
                  }}
                >
                  <Icon name="alert" size={13} color="var(--qw-danger)" />
                  <span className="font-semibold">
                    {c.mismatchCount ?? 0} mismatch{c.mismatchCount === 1 ? '' : 'es'} detected
                    {c.recordedAt ? ` · last recorded ${timeAgo(c.recordedAt)}` : ''}
                  </span>
                  <span className="font-mono opacity-80" style={{ color: 'var(--qw-fg-muted)' }}>
                    re-record to refresh the fixture
                  </span>
                </div>
              )}
              {c.status === 'missing' && (
                <div
                  className="flex items-center gap-3 px-[18px] py-2.5 text-[12px]"
                  style={{
                    background: 'var(--qw-warn-soft)',
                    borderTop: '1px solid var(--qw-border)',
                    color: 'var(--qw-warn)',
                  }}
                >
                  <Icon name="alert" size={13} color="var(--qw-warn)" />
                  <span className="font-semibold">{c.missingCount ?? 0} entries missing from this cassette</span>
                  <span className="font-mono opacity-80" style={{ color: 'var(--qw-fg-muted)' }}>
                    record a session to fill the gaps
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
