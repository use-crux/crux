import { useState } from 'react'
import { Btn } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { useToast } from '@/qw/shell/useToast'
import { useJudgeEvents } from '@/app/runtime/runtimeStore'
import { useQualityFeedback } from '@/shared/hooks/useQualityApi'
import type { JudgeEventData, QualityFeedbackRecord, Trace } from '@/types'

export function SaveAsCasePrompt() {
  const { toast } = useToast()
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div
      className="mt-6 flex items-center gap-3.5 rounded-[12px] px-[22px] py-4"
      style={{
        background: 'var(--qw-crux-soft)',
        border: '1px dashed var(--qw-crux-line)',
      }}
    >
      <Icon name="sparkle" size={20} color="var(--qw-crux)" />
      <div className="flex-1">
        <div className="text-[14px] font-semibold">Turn this run into a test?</div>
        <div className="mt-0.5 text-[12.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          Save the expected output as a case so the next experiment catches regressions.
        </div>
      </div>
      <Btn size="sm" onClick={() => setDismissed(true)}>
        Skip
      </Btn>
      <Btn
        size="sm"
        variant="primary"
        icon={<Icon name="layers" size={13} />}
        onClick={() =>
          toast({
            kind: 'info',
            title: 'Save as case',
            message: 'Pick a Suite and use "Add case" - one-click case capture from a trace is next.',
          })
        }
      >
        Save as case
      </Btn>
    </div>
  )
}

export function RunLevelView({
  trace,
  traceId,
  mode,
}: {
  trace: Trace | undefined
  traceId: string
  mode: 'feedback' | 'scores'
}) {
  const judgeEvents = useJudgeEvents()
  const feedback = useFeedbackForTrace(traceId)
  if (!trace) {
    return (
      <div className="px-8 py-10 text-[13px]" style={{ color: 'var(--qw-fg-muted)' }}>
        Trace not found in the local buffer.
      </div>
    )
  }

  const judges = judgeEvents.filter((j) => j.traceId === traceId)
  return (
    <div className="mx-auto h-full overflow-auto px-8 pb-12 pt-6" style={{ maxWidth: 1120 }}>
      {mode === 'feedback' && <RunFeedbackView feedback={feedback} traceId={traceId} />}
      {mode === 'scores' && <RunScoresView judges={judges} />}
    </div>
  )
}

function useFeedbackForTrace(traceId: string) {
  const { data } = useQualityFeedback()
  return (data ?? []).filter((f) => f.traceId === traceId)
}

function CardShell({
  label,
  right,
  children,
}: {
  label: React.ReactNode
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div
        className="flex items-center justify-between px-3.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em]"
        style={{
          color: 'var(--qw-fg-faint)',
          background: 'var(--qw-bg-muted)',
          borderBottom: '1px solid var(--qw-border)',
        }}
      >
        <span>{label}</span>
        {right}
      </div>
      {children}
    </div>
  )
}

function RunFeedbackView({ feedback, traceId }: { feedback: readonly QualityFeedbackRecord[]; traceId: string }) {
  if (feedback.length === 0) {
    return (
      <div
        className="rounded-[10px] px-6 py-10 text-center text-[13px]"
        style={{
          background: 'var(--qw-bg-elev)',
          border: '1px dashed var(--qw-border)',
          color: 'var(--qw-fg-muted)',
        }}
      >
        No feedback recorded for trace <code className="font-mono">{traceId.slice(0, 12)}</code>. Feedback shows up here
        when team-mates leave thumbs / comments via the SDK.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {feedback.map((f) => (
        <CardShell
          key={f.id}
          label={
            <span>
              {f.rating != null && f.rating > 0
                ? 'positive'
                : f.rating != null && f.rating < 0
                  ? 'negative'
                  : 'comment'}
              {' · '}
              {f.status}
            </span>
          }
          right={
            <span style={{ color: 'var(--qw-fg-muted)' }}>
              {f.createdAt ? new Date(f.createdAt).toLocaleString() : ''}
            </span>
          }
        >
          <div className="px-3.5 py-3">
            {f.comment && <div className="font-serif text-[13.5px] leading-[1.55]">{f.comment}</div>}
            {f.tags && f.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {f.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-[3px] px-1.5 py-px font-mono text-[10.5px]"
                    style={{ background: 'var(--qw-bg-muted)', color: 'var(--qw-fg-muted)' }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </CardShell>
      ))}
    </div>
  )
}

function RunScoresView({ judges }: { judges: readonly JudgeEventData[] }) {
  if (judges.length === 0) {
    return (
      <div
        className="rounded-[10px] px-6 py-10 text-center text-[13px]"
        style={{
          background: 'var(--qw-bg-elev)',
          border: '1px dashed var(--qw-border)',
          color: 'var(--qw-fg-muted)',
        }}
      >
        No judge scores for this trace. Scores appear here when a scorer / LLM judge runs against the output.
      </div>
    )
  }

  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      {judges.map((j) => {
        const tone =
          j.score >= 0.85
            ? 'var(--qw-ok)'
            : j.score >= 0.6
              ? 'var(--qw-crux)'
              : j.score < 0.4
                ? 'var(--qw-danger)'
                : 'var(--qw-warn)'
        const bg =
          j.score >= 0.85
            ? 'var(--qw-ok-soft)'
            : j.score >= 0.6
              ? 'var(--qw-crux-soft)'
              : j.score < 0.4
                ? 'var(--qw-danger-soft)'
                : 'var(--qw-warn-soft)'
        return (
          <div
            key={j.metricId + j.timestamp}
            className="rounded-[10px] px-4 py-3"
            style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
                {j.metricId}
              </span>
              <span
                className="rounded-[4px] px-2 py-0.5 font-mono text-[12px] font-semibold"
                style={{ background: bg, color: tone }}
              >
                {j.score.toFixed(2)}
              </span>
            </div>
            {j.reasoning && (
              <div className="text-[12px] leading-[1.55]" style={{ color: 'var(--qw-fg-faint)' }}>
                {j.reasoning}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
