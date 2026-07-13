/**
 * Scorers — "what am I grading on, and how's it doing?"
 *
 * One card per scorer used across experiments: code (deterministic) vs model
 * judge (gold; slow/costly), its mean score, how many cells it ran on, when it
 * was last used, and which evaluations use it. Derived from experiment cells.
 */

import { useState } from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip } from '@/qw/shell/primitives'
import { FilterButton } from '@/qw/shell/FilterPopover'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { useQualityScorers } from '@/shared/hooks/useQualityApi'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import { SkeletonRows } from '@/shared/components/Skeleton'
import { QEmpty, ScoreStat, timeAgo } from '@/qw/shell/qualityKit'
import { JudgeReportPanel } from '@/shared/quality/JudgeReportPanel'

export function ScorersView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const { data: scorers, loading } = useQualityScorers()
  const list = scorers ?? []
  const judges = list.filter((s) => s.costClass === 'model').length
  const [tab, setTab] = useState<'all' | 'code' | 'model'>('all')
  const [openTrust, setOpenTrust] = useState<string | null>(null)
  const shown = tab === 'all' ? list : list.filter((s) => (s.costClass === 'model') === (tab === 'model'))

  return (
    <QwShell
      activeView="scorers"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Evaluate / Scorers"
      title="Scorers"
      subtitle={`${list.length} in use · ${judges} model judge${judges === 1 ? '' : 's'}`}
      connected={connected}
      actions={
        <FilterButton
          title="Show"
          value={tab}
          noneValue="all"
          options={[
            { value: 'all', label: `All · ${list.length}` },
            { value: 'code', label: `Code · ${list.length - judges}` },
            { value: 'model', label: `Model judges · ${judges}` },
          ]}
          onChange={setTab}
        />
      }
    >
      <div className="px-8 pb-10 pt-6">
        {loading && list.length === 0 ? (
          <SkeletonRows rows={6} rowHeight={64} />
        ) : list.length === 0 ? (
          <QEmpty
            icon="spark"
            title="No scorers yet"
            body="Scorers are discovered from experiment cells. Run an evaluation that grades its output and they show up here."
          />
        ) : shown.length === 0 ? (
          <div className="px-1 py-10 text-center font-mono text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
            No {tab === 'model' ? 'model judge' : tab} scorers.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {shown.map((s) => {
              const isModel = s.costClass === 'model'
              const col = isModel ? 'var(--qw-gold)' : 'var(--qw-fg-muted)'
              return (
                <div
                  key={s.name}
                  className="flex flex-col gap-3 rounded-[12px] px-[18px] py-4"
                  style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="flex size-[30px] items-center justify-center rounded-[8px]"
                      style={{ background: isModel ? 'var(--qw-gold-soft)' : 'var(--qw-bg-muted)', boxShadow: `inset 0 0 0 1px ${isModel ? 'var(--qw-gold-line)' : 'var(--qw-border)'}` }}
                    >
                      <Icon name={isModel ? 'sparkle' : 'check'} size={15} color={col} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-[13px] font-semibold">{s.name}</span>
                      <div className="font-mono text-[10.5px] uppercase tracking-[0.06em]" style={{ color: 'var(--qw-fg-faint)' }}>
                        {isModel ? 'model judge · slow / costly' : 'code · deterministic'}
                      </div>
                    </div>
                    <ScoreStat value={s.meanScore ?? null} sem={isModel ? 0.05 : 0.01} width={72} />
                    {isModel && s.evaluationIds.length > 0 && (
                      <Btn
                        size="xs"
                        variant="soft"
                        icon={<Icon name="compare" size={11} />}
                        title="judge-vs-human agreement"
                        onClick={() => setOpenTrust((cur) => (cur === s.name ? null : s.name))}
                      >
                        Trust
                      </Btn>
                    )}
                  </div>
                  <div
                    className="flex gap-4 pt-2.5 font-mono text-[11px]"
                    style={{ borderTop: '1px solid var(--qw-border)', color: 'var(--qw-fg-muted)' }}
                  >
                    <span>{s.cellCount} cells</span>
                    {s.lastUsedAt && <span>last {timeAgo(s.lastUsedAt) || s.lastUsedAt}</span>}
                    <span className="ml-auto">
                      used by {s.evaluationIds.length} eval{s.evaluationIds.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.evaluationIds.map((id) => (
                      <Chip key={id} tone="muted" mono>
                        {id}
                      </Chip>
                    ))}
                  </div>
                  {openTrust === s.name && (
                    <div className="flex flex-col gap-3 pt-2" style={{ borderTop: '1px solid var(--qw-border)' }}>
                      {s.evaluationIds.map((id) => (
                        <div key={id} className="flex flex-col gap-1.5">
                          <span className="font-mono text-[10.5px] uppercase tracking-[0.06em]" style={{ color: 'var(--qw-fg-faint)' }}>
                            {id}
                          </span>
                          <JudgeReportPanel evaluationId={id} scorerName={s.name} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </QwShell>
  )
}
