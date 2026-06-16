/**
 * Feedback — kept, internal-only, a minor surface. A light list of human
 * thumbs / notes on runs, each linking to its trace. Not a Quality headline.
 * Status mutations (mark reviewed / dismiss) go through useFeedbackMutation.
 */

import * as React from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import type { IconName } from '@/qw/shell/nav'
import { navTarget } from '@/app/navigation/navTarget'
import { useQualityFeedback } from '@/shared/hooks/useQualityApi'
import { useFeedbackMutation } from '@/shared/hooks/useQualityMutations'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import { SkeletonRows } from '@/shared/components/Skeleton'
import { QEmpty, shortId, timeAgo } from '@/qw/shell/qualityKit'
import type { QualityFeedbackRecord } from '@/types'

type FbKind = 'up' | 'down' | 'note'
const KIND_META: Record<FbKind, { icon: IconName; color: string; label: string }> = {
  up: { icon: 'check', color: 'var(--qw-ok)', label: 'positive' },
  down: { icon: 'x', color: 'var(--qw-danger)', label: 'negative' },
  note: { icon: 'inbox', color: 'var(--qw-crux)', label: 'note' },
}

function fbKind(f: QualityFeedbackRecord): FbKind {
  if (f.rating === 1) return 'up'
  if (f.rating === -1) return 'down'
  return 'note'
}

type FbTab = 'all' | 'new' | 'reviewed' | 'dismissed'

export function FeedbackView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const updateFeedback = useFeedbackMutation()
  const { data: feedback, loading } = useQualityFeedback()
  const list = feedback ?? []
  const [tab, setTab] = React.useState<FbTab>('all')

  const counts = React.useMemo(() => {
    let n = 0
    let r = 0
    let d = 0
    for (const f of list) {
      if (f.status === 'new') n++
      else if (f.status === 'reviewed') r++
      else if (f.status === 'dismissed') d++
    }
    return { all: list.length, new: n, reviewed: r, dismissed: d }
  }, [list])

  const shown = list.filter((f) => (tab === 'all' ? true : f.status === tab))

  return (
    <QwShell
      activeView="feedback"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Inspect / Feedback"
      title="Feedback"
      subtitle={`${counts.new} new · internal-only signals on runs`}
      connected={connected}
      tabs={[
        { label: 'All', active: tab === 'all', count: counts.all, onClick: () => setTab('all') },
        { label: 'New', active: tab === 'new', count: counts.new, onClick: () => setTab('new') },
        { label: 'Reviewed', active: tab === 'reviewed', count: counts.reviewed, onClick: () => setTab('reviewed') },
        { label: 'Dismissed', active: tab === 'dismissed', count: counts.dismissed, onClick: () => setTab('dismissed') },
      ]}
    >
      <div className="flex flex-col gap-3 px-8 pb-10 pt-5">
        {loading && list.length === 0 ? (
          <SkeletonRows rows={5} rowHeight={64} />
        ) : shown.length === 0 ? (
          <QEmpty
            icon="inbox"
            title={tab === 'all' ? 'No feedback yet' : `No ${tab} feedback`}
            body="Thumbs and notes left on runs land here. They're internal-only signals — not part of the public quality model."
          />
        ) : (
          shown.map((f) => {
            const k = fbKind(f)
            const km = KIND_META[k]
            return (
              <div
                key={f.id}
                className="grid items-start gap-3 rounded-[10px] px-4 py-3.5"
                style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)', gridTemplateColumns: '32px 1fr auto' }}
              >
                <div
                  className="flex size-[30px] items-center justify-center rounded-full"
                  style={{ background: 'var(--qw-bg-muted)', boxShadow: 'inset 0 0 0 1px var(--qw-border)' }}
                >
                  <Icon name={km.icon} size={14} color={km.color} />
                </div>
                <div className="min-w-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-[4px] px-[7px] py-[2px] text-[11px] font-medium"
                      style={{ background: 'var(--qw-bg-muted)', color: km.color }}
                    >
                      <Icon name={km.icon} size={11} color={km.color} />
                      {km.label}
                    </span>
                    <Chip tone={f.status === 'new' ? 'crux' : 'muted'} dot>
                      {f.status}
                    </Chip>
                    <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                      · {timeAgo(f.createdAt)}
                    </span>
                  </div>
                  {f.comment && (
                    <div className="mb-1.5 text-[13px] leading-[1.55]" style={{ fontFamily: 'var(--qw-serif)' }}>
                      {f.comment}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                    {f.traceId && <span style={{ color: 'var(--qw-crux)' }}>{shortId(f.traceId)}</span>}
                    {f.experimentId && (
                      <>
                        <span>·</span>
                        <span>{shortId(f.experimentId)}</span>
                      </>
                    )}
                    {f.caseId && (
                      <>
                        <span>·</span>
                        <span>{f.caseId}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {f.traceId && (
                    <Btn size="xs" icon={<Icon name="trace" size={11} />} onClick={() => navigate({ view: 'run-detail', traceId: f.traceId! })}>
                      Open trace
                    </Btn>
                  )}
                  {f.status === 'new' && (
                    <Btn size="xs" icon={<Icon name="check" size={11} />} onClick={() => void updateFeedback(f.id, 'reviewed')}>
                      Reviewed
                    </Btn>
                  )}
                  {f.status !== 'dismissed' && (
                    <Btn size="xs" icon={<Icon name="x" size={11} />} onClick={() => void updateFeedback(f.id, 'dismissed')}>
                      Dismiss
                    </Btn>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </QwShell>
  )
}
