/**
 * Shared detail panel for prompt eval cases.
 *
 * Shows input, output, scores, error, and metrics in a structured layout
 * matching the visual patterns of FlowCaseDetail.
 */

import { useState } from 'react'
import type { EvalCaseData } from '@/types'
import { JsonTree } from '@/shared/components/JsonTree'
import { fmt, ChevronToggle } from '@/shared/components/ui-atoms'
import {
  CodeBlock,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockCopyButton,
} from '@/shared/components/ai-elements/code-block'

interface EvalCaseDetailProps {
  result: EvalCaseData
  onViewTrace?: () => void
}

// ─── Collapsible Section ────────────────────────────────────────

function Section({
  title,
  accent = 'zinc',
  defaultOpen = true,
  badge,
  children,
}: {
  title: string
  accent?: 'zinc' | 'red' | 'emerald' | 'amber' | 'blue'
  defaultOpen?: boolean
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const borderColor = {
    zinc: 'border-l-zinc-600',
    red: 'border-l-red-500/50',
    emerald: 'border-l-emerald-500/50',
    amber: 'border-l-amber-500/50',
    blue: 'border-l-blue-500/50',
  }[accent]

  return (
    <div className={`border-l-2 ${borderColor} rounded-r`}>
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-zinc-800/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{title}</span>
        {badge}
        <span className="ml-auto">
          <ChevronToggle open={open} />
        </span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}

// ─── Score Bar ──────────────────────────────────────────────────

function ScoreBar({ score, max = 5 }: { score: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100)
  const color = score >= 4 ? 'bg-(--qw-ok)' : score >= 3 ? 'bg-(--qw-warn)' : 'bg-(--qw-danger)'
  return (
    <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────

export function EvalCaseDetail({ result, onViewTrace }: EvalCaseDetailProps) {
  const hasInput = result.input != null
  const hasOutput = result.output != null
  const hasScores = result.scores && Object.keys(result.scores).length > 0
  const hasError = !!result.error

  return (
    <div className="space-y-2">
      {/* Header with metrics */}
      <div className="flex items-center gap-3 text-[11px]">
        <span className={`w-2 h-2 rounded-full ${result.passed ? 'bg-(--qw-ok)' : 'bg-(--qw-danger)'}`} />
        <span className="font-mono text-zinc-200">{result.caseName}</span>
        <span className="text-zinc-600">on</span>
        <span className="font-mono text-zinc-400 text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded">{result.modelId}</span>
        <span className="text-zinc-600 tabular-nums">{fmt(result.durationMs, 'ms')}</span>
        {result.usage?.totalTokens != null && (
          <span className="text-zinc-600 tabular-nums">{fmt(result.usage.totalTokens, 'tok')}</span>
        )}
        {result.cost != null && result.cost > 0 && (
          <span className="text-zinc-600 tabular-nums">{fmt(result.cost, '$')}</span>
        )}
        {result.failureCategory && (
          <span className="px-1.5 py-0.5 rounded-full bg-(--qw-danger-soft) text-(--qw-danger) text-[9px]">
            {result.failureCategory}
          </span>
        )}
        {onViewTrace && (
          <button
            className="ml-auto text-[10px] text-zinc-600 hover:text-(--qw-crux) transition-colors"
            onClick={onViewTrace}
          >
            View trace →
          </button>
        )}
      </div>

      {/* Error (shown first if present — most important for failures) */}
      {hasError && (
        <Section title="Error" accent="red" defaultOpen={true}>
          <pre className="text-(--qw-danger) whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed">
            {result.error}
          </pre>
        </Section>
      )}

      {/* Input */}
      {hasInput && (
        <Section title="Input" accent="blue" defaultOpen={!result.passed}>
          {typeof result.input === 'string' ? (
            <CodeBlock code={result.input} language="json">
              <CodeBlockHeader>
                <CodeBlockTitle>
                  <span className="text-[10px] text-zinc-500">Input</span>
                </CodeBlockTitle>
                <CodeBlockActions>
                  <CodeBlockCopyButton />
                </CodeBlockActions>
              </CodeBlockHeader>
            </CodeBlock>
          ) : (
            <JsonTree data={result.input} />
          )}
        </Section>
      )}

      {/* Output */}
      {hasOutput && (
        <Section title="Output" accent={result.passed ? 'emerald' : 'amber'} defaultOpen={true}>
          {typeof result.output === 'string' ? (
            <CodeBlock code={result.output} language="markdown">
              <CodeBlockHeader>
                <CodeBlockTitle>
                  <span className="text-[10px] text-zinc-500">Output</span>
                </CodeBlockTitle>
                <CodeBlockActions>
                  <CodeBlockCopyButton />
                </CodeBlockActions>
              </CodeBlockHeader>
            </CodeBlock>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <JsonTree data={result.output} />
            </div>
          )}
        </Section>
      )}

      {/* Scores */}
      {hasScores && (
        <Section title="Scores" accent="zinc" defaultOpen={true}>
          <div className="space-y-1.5">
            {Object.entries(result.scores!).map(([id, s]) => (
              <div key={id} className="flex items-center gap-3">
                <span className="text-zinc-400 font-mono text-[10px] w-28 shrink-0">{id}</span>
                <ScoreBar score={s.score} />
                <span
                  className={`text-[11px] tabular-nums w-8 shrink-0 ${
                    s.score >= 4 ? 'text-(--qw-ok)' : s.score >= 3 ? 'text-(--qw-warn)' : 'text-(--qw-danger)'
                  }`}
                >
                  {s.score.toFixed(1)}
                </span>
                {s.reasoning && <span className="text-zinc-600 text-[10px] truncate">{s.reasoning}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
