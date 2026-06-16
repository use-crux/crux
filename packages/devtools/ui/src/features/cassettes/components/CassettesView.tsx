/**
 * Cassettes — "is my deterministic replay healthy?"
 *
 * An explainer band (live / record / replay-strict), then the recordings.
 * Staleness is the headline: recordings past the 90-day window are warn-tinted
 * and nudge a re-record. Re-recording is a CLI action — the workbench flags
 * staleness and shows the command.
 */

import * as React from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { useQualityCassettes, useQualityEvaluations } from '@/shared/hooks/useQualityApi'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import { useToast } from '@/qw/shell/useToast'
import { SkeletonRows } from '@/shared/components/Skeleton'
import { CliHint, QEmpty, ReplayBadge, fmtBytes, timeAgo } from '@/qw/shell/qualityKit'
import type { QualityCassetteRecord } from '@/types'

const EXPLAINERS: { mode: string; desc: string }[] = [
  { mode: 'live', desc: 'Real model calls are made and paid for.' },
  { mode: 'record-new', desc: 'Calls are made once and saved into a cassette.' },
  { mode: 'replay-strict', desc: 'No calls — replayed from the cassette. Free, deterministic, CI-ready. A missing entry errors the cell.' },
]

export function CassettesView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const { toast } = useToast()
  const { data: cassettes, loading } = useQualityCassettes()
  const { data: evaluations } = useQualityEvaluations()
  const list = cassettes ?? []
  const staleCount = list.filter((c) => c.stale).length

  // Which evaluations declare each cassette as their replay source.
  const usedBy = React.useMemo(() => {
    const map = new Map<string, string[]>()
    for (const e of evaluations ?? []) {
      const cass = e.replay?.cassette
      if (!cass) continue
      if (!map.has(cass)) map.set(cass, [])
      map.get(cass)!.push(e.id)
    }
    return map
  }, [evaluations])

  const reRecord = (c: QualityCassetteRecord) => {
    const target = usedBy.get(c.name)?.[0] ?? c.name
    const cmd = `crux quality run ${target} --replay refresh`
    void navigator.clipboard?.writeText(cmd)
    toast({ kind: 'ok', title: 'Re-record command copied', message: cmd })
  }

  return (
    <QwShell
      activeView="cassettes"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Evaluate / Cassettes"
      title="Cassettes"
      subtitle={`${list.length} recordings${staleCount > 0 ? ` · ${staleCount} stale` : ''}`}
      connected={connected}
    >
      <div className="px-8 pb-10 pt-6">
        {/* explainer band */}
        <div className="mb-[22px] grid grid-cols-3 gap-3">
          {EXPLAINERS.map((x) => (
            <div key={x.mode} className="rounded-[10px] px-3.5 py-3" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
              <ReplayBadge mode={x.mode} />
              <p className="mt-2 text-[11.5px] leading-[1.5]" style={{ color: 'var(--qw-fg-muted)' }}>
                {x.desc}
              </p>
            </div>
          ))}
        </div>

        {staleCount > 0 && (
          <div
            className="mb-4 flex items-center gap-2.5 rounded-[10px] px-4 py-3"
            style={{ background: 'var(--qw-warn-soft)', boxShadow: 'inset 0 0 0 1px var(--qw-warn-line)' }}
          >
            <Icon name="alert" size={16} color="var(--qw-warn)" />
            <span className="text-[12.5px]" style={{ color: 'var(--qw-fg)' }}>
              <b>
                {staleCount} cassette{staleCount === 1 ? ' is' : 's are'} past the 90-day window.
              </b>{' '}
              Strict replay against {staleCount === 1 ? 'it' : 'them'} may be silently wrong — re-record before trusting CI.
            </span>
          </div>
        )}

        {loading && list.length === 0 ? (
          <SkeletonRows rows={5} rowHeight={48} />
        ) : list.length === 0 ? (
          <QEmpty
            icon="cassette"
            title="No cassettes recorded"
            body="Record an evaluation's model calls once and they replay deterministically for free in CI."
            action={<CliHint cmd="crux quality run <evaluation> --replay record-new" />}
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-[12px]" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
              <div
                className="grid gap-3.5 px-[18px] py-2 font-mono text-[10px] uppercase tracking-[0.08em]"
                style={{ gridTemplateColumns: '1fr 120px 90px 80px 80px 110px', borderBottom: '1px solid var(--qw-border)', color: 'var(--qw-fg-faint)' }}
              >
                <span>cassette</span>
                <span>age</span>
                <span className="text-right">entries</span>
                <span className="text-right">size</span>
                <span>sdk</span>
                <span />
              </div>
              {list.map((c, i) => {
                const users = usedBy.get(c.name) ?? []
                return (
                  <div
                    key={c.name}
                    className="grid items-center gap-3.5 px-[18px] py-3 text-[12.5px]"
                    style={{
                      gridTemplateColumns: '1fr 120px 90px 80px 80px 110px',
                      borderBottom: i === list.length - 1 ? 'none' : '1px solid var(--qw-border)',
                      background: c.stale ? 'var(--qw-warn-soft)' : 'transparent',
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon name="cassette" size={16} color={c.stale ? 'var(--qw-warn)' : 'var(--qw-fg-muted)'} />
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[12px] font-medium">{c.name}</div>
                        <div className="truncate font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                          {c.models.join(' · ')}
                          {users.length ? ` · used by ${users.join(', ')}` : ''}
                        </div>
                      </div>
                    </div>
                    <div>
                      {c.stale ? (
                        <Chip tone="warn" dot>
                          stale
                        </Chip>
                      ) : (
                        <span className="font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                          {timeAgo(c.recordedAt) || c.recordedAt}
                        </span>
                      )}
                    </div>
                    <span className="text-right font-mono text-[11.5px]">{c.entryCount}</span>
                    <span className="text-right font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                      {fmtBytes(c.sizeBytes)}
                    </span>
                    <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                      {c.sdkVersion}
                    </span>
                    <div className="flex justify-end">
                      {c.stale ? (
                        <Btn size="xs" variant="soft" icon={<Icon name="loop" size={11} />} onClick={() => reRecord(c)}>
                          Re-record
                        </Btn>
                      ) : (
                        <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                          healthy
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3">
              <CliHint
                cmd="crux quality run <evaluation> --replay refresh"
                note="Re-recording is a CLI action — the workbench flags staleness and explains the fix."
              />
            </div>
          </>
        )}
      </div>
    </QwShell>
  )
}
