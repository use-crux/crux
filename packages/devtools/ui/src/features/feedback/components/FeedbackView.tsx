/**
 * Feedback inbox — local human/user judgments attached to a trace.
 *
 * Tabs split items by status; each row shows the rating, comment,
 * linked trace, and actions to triage into a dataset case.
 */

import { useMemo, useState } from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip, type ChipTone } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { useFeedbackMutation } from '@/shared/hooks/useQualityMutations'
import { useQualityFeedbackSuspense } from '@/shared/hooks/useQualityApi'
import { useToast } from '@/qw/shell/useToast'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import type { QualityFeedbackRecord } from '@/types'

const STATUS_TONE: Record<QualityFeedbackRecord['status'], ChipTone> = {
  new: 'crux',
  reviewed: 'iris',
  dismissed: 'muted',
}

function ratingChip(r: number | undefined): { label: string; tone: ChipTone; icon: 'check' | 'x' | 'inbox' } {
  if (r == null) return { label: 'comment', tone: 'crux', icon: 'inbox' }
  if (r > 0) return { label: 'positive', tone: 'ok', icon: 'check' }
  if (r < 0) return { label: 'negative', tone: 'danger', icon: 'x' }
  return { label: 'neutral', tone: 'muted', icon: 'inbox' }
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (!ts) return ''
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

type Tab = 'new' | 'reviewed' | 'dismissed' | 'all'

export function FeedbackView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const [tab, setTab] = useState<Tab>('new')
  const updateFeedback = useFeedbackMutation()
  const { toast } = useToast()
  const [hidden, setHidden] = useState<readonly string[]>([])
  // Suspends on first paint — caught by the top-level App Suspense
  // (or any parent SectionBoundary). Once cached, mutations + WS
  // invalidations refresh in the background without re-suspending.
  const qualityFeedback = useQualityFeedbackSuspense()

  const counts = useMemo(() => {
    const c = { new: 0, reviewed: 0, dismissed: 0 }
    for (const f of qualityFeedback) c[f.status]++
    return c
  }, [qualityFeedback])

  const items = useMemo(() => {
    const base = tab === 'all' ? qualityFeedback : qualityFeedback.filter((f) => f.status === tab)
    return base.filter((f) => !hidden.includes(f.id))
  }, [qualityFeedback, tab, hidden])

  async function setStatus(id: string, status: 'new' | 'reviewed' | 'dismissed') {
    setHidden((h) => [...h, id])
    await updateFeedback(id, status)
  }

  return (
    <QwShell
      activeView="feedback"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Loop / Feedback"
      title="Feedback to triage"
      subtitle={`${counts.new} new · ${qualityFeedback.length} total`}
      connected={connected}
      badges={{ feedback: counts.new > 0 ? { count: counts.new, tone: 'crux' } : undefined }}
      actions={
        <>
          <Btn
            icon={<Icon name="filter" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Kind filter',
                message: 'Multi-select + filter chip UI is next. Tabs above cover status filters.',
              })
            }
          >
            All kinds
          </Btn>
          <Btn
            variant="primary"
            icon={<Icon name="layers" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Convert selected to cases',
                message: 'Multi-select + dataset picker coming next — for now use "Save as case" per item.',
              })
            }
          >
            Convert selected
          </Btn>
        </>
      }
      tabs={[
        { label: 'Inbox', active: tab === 'new', count: counts.new, iconName: 'inbox', onClick: () => setTab('new') },
        { label: 'Reviewed', active: tab === 'reviewed', count: counts.reviewed, onClick: () => setTab('reviewed') },
        {
          label: 'Dismissed',
          active: tab === 'dismissed',
          count: counts.dismissed,
          onClick: () => setTab('dismissed'),
        },
        { label: 'All', active: tab === 'all', count: qualityFeedback.length, onClick: () => setTab('all') },
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
            No feedback to triage. Thumbs / comments / suggested expected answers will land here.
          </div>
        )}
        {items.map((f) => {
          const r = ratingChip(f.rating)
          return (
            <div
              key={f.id}
              className="grid items-start gap-3 rounded-[10px] px-4 py-3.5"
              style={{
                gridTemplateColumns: '24px 1fr auto',
                background: 'var(--qw-bg-elev)',
                border: '1px solid var(--qw-border)',
              }}
            >
              <div
                className="mt-1 size-3.5 rounded-[3px]"
                style={{ border: '1px solid var(--qw-border-strong)', background: 'var(--qw-bg)' }}
              />
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium"
                    style={{
                      background: 'var(--qw-bg-muted)',
                      color: `var(--qw-${r.tone})`,
                    }}
                  >
                    <Icon name={r.icon} size={11} color={`var(--qw-${r.tone})`} />
                    {r.label}
                  </span>
                  <Chip tone={STATUS_TONE[f.status]} dot>
                    {f.status}
                  </Chip>
                  {f.tags?.map((t) => (
                    <Chip key={t} tone="muted">
                      {t}
                    </Chip>
                  ))}
                  <span className="ml-auto font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                    {timeAgo(f.createdAt)}
                  </span>
                </div>
                <div className="mb-1.5 font-serif text-[13.5px] leading-[1.55]" style={{ color: 'var(--qw-fg)' }}>
                  {f.comment ?? '(no comment)'}
                </div>
                {f.traceId && (
                  <div
                    className="flex items-center gap-2.5 font-mono text-[11.5px]"
                    style={{ color: 'var(--qw-fg-muted)' }}
                  >
                    <span style={{ color: 'var(--qw-crux)' }}>trace {f.traceId.slice(0, 12)}</span>
                  </div>
                )}
              </div>
              <div className="flex flex-shrink-0 gap-1.5">
                {f.traceId && (
                  <Btn
                    size="xs"
                    icon={<Icon name="trace" size={11} />}
                    onClick={() => navigate({ view: 'run-detail', traceId: f.traceId! })}
                  >
                    Open trace
                  </Btn>
                )}
                <Btn
                  size="xs"
                  variant={f.status === 'new' ? 'primary' : 'ghost'}
                  icon={<Icon name="layers" size={11} />}
                  onClick={() =>
                    toast({
                      kind: 'info',
                      title: 'Save as case',
                      message: 'Pick a Suite and use "Add case" — bulk converter UI coming next.',
                    })
                  }
                >
                  Save as case
                </Btn>
                {f.status !== 'reviewed' && (
                  <Btn size="xs" icon={<Icon name="check" size={11} />} onClick={() => setStatus(f.id, 'reviewed')}>
                    Mark reviewed
                  </Btn>
                )}
                {f.status !== 'dismissed' && (
                  <Btn size="xs" icon={<Icon name="x" size={11} />} onClick={() => setStatus(f.id, 'dismissed')}>
                    Dismiss
                  </Btn>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </QwShell>
  )
}
