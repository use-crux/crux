import { useState } from 'react'
import type { FlowStepDetail } from '@/types'
import { JsonTree } from '@/shared/components/JsonTree'
import { fmt, ChevronToggle } from '@/shared/components/ui-atoms'
import {
  CodeBlock,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockCopyButton,
} from '@/shared/components/ai-elements/code-block'
import { Tool, ToolContent } from '@/shared/components/ai-elements/tool'
import { CollapsibleTrigger } from '@/shared/components/ui/collapsible'
import { Badge } from '@/shared/components/ui/badge'
import { WrenchIcon, CheckCircleIcon, ChevronDownIcon } from 'lucide-react'

interface FlowCaseDetailProps {
  steps: FlowStepDetail[]
  onClose?: () => void
}

// ─── Cost Breakdown Bar ─────────────────────────────────────────

const STEP_COLORS = [
  'bg-(--qw-blue)',
  'bg-(--qw-ok)',
  'bg-(--qw-warn)',
  'bg-(--qw-iris)',
  'bg-(--qw-plum)',
  'bg-(--qw-crux)',
  'bg-(--qw-gold)',
  'bg-(--qw-blue)',
]

const STEP_TEXT_COLORS = [
  'text-(--qw-blue)',
  'text-(--qw-ok)',
  'text-(--qw-warn)',
  'text-(--qw-iris)',
  'text-(--qw-plum)',
  'text-(--qw-crux)',
  'text-(--qw-gold)',
  'text-(--qw-blue)',
]

function CostBar({ steps }: { steps: FlowStepDetail[] }) {
  const totalCost = steps.reduce((sum, s) => sum + s.cost, 0)
  if (totalCost <= 0) return null

  const segments = steps
    .filter((s) => !s.skipped && s.cost > 0)
    .map((s, i) => ({
      id: s.id,
      cost: s.cost,
      pct: (s.cost / totalCost) * 100,
      color: STEP_COLORS[i % STEP_COLORS.length],
      textColor: STEP_TEXT_COLORS[i % STEP_TEXT_COLORS.length],
    }))

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">Cost Breakdown</div>
      <div className="flex h-2 rounded-full overflow-hidden bg-zinc-800">
        {segments.map((seg) => (
          <div
            key={seg.id}
            className={`${seg.color} transition-all`}
            style={{ width: `${Math.max(seg.pct, 1)}%` }}
            title={`${seg.id}: ${fmt(seg.cost, '$')} (${seg.pct.toFixed(0)}%)`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {segments.map((seg) => (
          <div key={seg.id} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-sm ${seg.color}`} />
            <span className="text-[10px] text-zinc-400 font-mono">{seg.id}</span>
            <span className={`text-[10px] tabular-nums ${seg.textColor}`}>
              {fmt(seg.cost, '$')} ({seg.pct.toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Step Card ──────────────────────────────────────────────────

function StepCard({ step, colorIdx }: { step: FlowStepDetail; colorIdx: number }) {
  const [expanded, setExpanded] = useState(false)
  const color = STEP_TEXT_COLORS[colorIdx % STEP_TEXT_COLORS.length]
  const borderColor = STEP_COLORS[colorIdx % STEP_COLORS.length]

  if (step.skipped) {
    return (
      <div className="border border-zinc-800 rounded-lg px-3 py-2 opacity-50">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-medium text-zinc-500">{step.id}</span>
          <span className="text-[10px] text-zinc-600 italic">skipped</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`border border-zinc-800 rounded-lg overflow-hidden`}>
      {/* Collapsed header */}
      <div
        className="px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-zinc-800/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className={`w-1 h-6 rounded-full ${borderColor} shrink-0`} />
        <span className={`text-[11px] font-mono font-medium ${color}`}>{step.id}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-(--qw-blue-soft) text-(--qw-blue) font-mono">{step.modelId}</span>
        <div className="ml-auto flex items-center gap-2 text-[11px] tabular-nums text-zinc-500">
          <span>{fmt(step.durationMs, 'ms')}</span>
          {step.totalTokens > 0 && <span>{fmt(step.totalTokens, 'tok')}</span>}
          {step.cost > 0 && <span>{fmt(step.cost, '$')}</span>}
          {step.toolCalls.length > 0 && (
            <span className="text-zinc-600">
              {step.toolCalls.length} tool{step.toolCalls.length > 1 ? 's' : ''}
            </span>
          )}
          <ChevronToggle open={expanded} className="w-2.5 h-2.5" />
        </div>
      </div>

      {/* Expanded sections */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-zinc-800 pt-3 space-y-3">
          {/* Input */}
          {step.input != null && (
            <Section title="Input">
              <div className="bg-zinc-950 rounded p-2 max-h-48 overflow-auto text-[11px] font-mono">
                <JsonTree data={step.input} />
              </div>
            </Section>
          )}

          {/* Output */}
          {(step.text != null || step.output != null) && (
            <Section title="Output">
              {step.text != null ? (
                <CodeBlock code={step.text} language="markdown">
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
                <div className="bg-zinc-950 rounded p-2 max-h-48 overflow-auto text-[11px] font-mono">
                  <JsonTree data={step.output} />
                </div>
              )}
            </Section>
          )}

          {/* Tool Calls */}
          {step.toolCalls.length > 0 && !step.turns && (
            <Section title={`Tool Calls (${step.toolCalls.length})`}>
              <div className="space-y-2">
                {step.toolCalls.map((tc, i) => (
                  <ToolCallCard key={i} tc={tc} />
                ))}
              </div>
            </Section>
          )}

          {/* Conversation (multiturn) */}
          {step.turns && step.turns.length > 0 && (
            <Section title={`Conversation (${step.turns.length} turns)`}>
              <div className="space-y-2">
                {step.turns.map((turn, i) => (
                  <TurnCard key={i} turn={turn} index={i} />
                ))}
              </div>
            </Section>
          )}

          {/* Usage */}
          <Section title="Usage">
            <div className="flex items-center gap-4 text-[11px] tabular-nums">
              <span className="text-zinc-400">
                Input: <span className="text-zinc-300">{fmt(step.inputTokens, 'tok')}</span>
              </span>
              <span className="text-zinc-400">
                Output: <span className="text-zinc-300">{fmt(step.outputTokens, 'tok')}</span>
              </span>
              <span className="text-zinc-400">
                Total: <span className="text-zinc-300">{fmt(step.totalTokens, 'tok')}</span>
              </span>
              {step.cost > 0 && (
                <span className="text-zinc-400">
                  Cost: <span className="text-zinc-300">{fmt(step.cost, '$')}</span>
                </span>
              )}
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}

// ─── Shared UI helpers ──────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{title}</div>
      {children}
    </div>
  )
}

function ToolCallCard({ tc }: { tc: { name: string; args: unknown; result: unknown } }) {
  const [showResult, setShowResult] = useState(false)
  return (
    <Tool defaultOpen={false}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2">
          <WrenchIcon className="size-3.5 text-muted-foreground" />
          <span className="text-[11px] font-mono font-medium text-(--qw-blue)">{tc.name}</span>
          <Badge className="gap-1 rounded-full text-[10px]" variant="secondary">
            <CheckCircleIcon className="size-3 text-(--qw-ok)" />
            Done
          </Badge>
        </div>
        <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <ToolContent>
        <div className="space-y-2 text-[11px]">
          <div>
            <h4 className="font-medium text-muted-foreground text-[10px] uppercase tracking-wide mb-1">Args</h4>
            <div className="font-mono max-h-32 overflow-auto">
              <JsonTree data={tc.args} />
            </div>
          </div>
          <div>
            <h4 className="font-medium text-muted-foreground text-[10px] uppercase tracking-wide mb-1">Result</h4>
            <div className="font-mono max-h-32 overflow-auto">
              <JsonTree data={tc.result} />
            </div>
          </div>
        </div>
      </ToolContent>
    </Tool>
  )
}

function TurnCard({ turn, index }: { turn: NonNullable<FlowStepDetail['turns']>[number]; index: number }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded border border-zinc-800/50 overflow-hidden">
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-zinc-800/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[10px] text-zinc-600 tabular-nums">#{index + 1}</span>
        <span className="text-[11px] text-zinc-400 truncate flex-1">
          {turn.userMessage.slice(0, 60)}
          {turn.userMessage.length > 60 ? '...' : ''}
        </span>
        <div className="flex items-center gap-2 text-[10px] tabular-nums text-zinc-600 shrink-0">
          <span>{fmt(turn.durationMs, 'ms')}</span>
          {turn.inputTokens + turn.outputTokens > 0 && <span>{fmt(turn.inputTokens + turn.outputTokens, 'tok')}</span>}
          {turn.toolCalls.length > 0 && <span>{turn.toolCalls.length} tools</span>}
          <ChevronToggle open={expanded} className="w-2.5 h-2.5" />
        </div>
      </div>

      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-zinc-800/50 pt-2">
          {/* User message */}
          <CodeBlock code={turn.userMessage} language="markdown">
            <CodeBlockHeader>
              <CodeBlockTitle>
                <span className="text-[10px] text-(--qw-blue)">User</span>
              </CodeBlockTitle>
              <CodeBlockActions>
                <CodeBlockCopyButton />
              </CodeBlockActions>
            </CodeBlockHeader>
          </CodeBlock>

          {/* Tool calls for this turn */}
          {turn.toolCalls.length > 0 && (
            <div className="space-y-1.5">
              {turn.toolCalls.map((tc, i) => (
                <ToolCallCard key={i} tc={tc} />
              ))}
            </div>
          )}

          {/* Assistant response */}
          <CodeBlock code={turn.response} language="markdown">
            <CodeBlockHeader>
              <CodeBlockTitle>
                <span className="text-[10px] text-zinc-500">Assistant</span>
              </CodeBlockTitle>
              <CodeBlockActions>
                <CodeBlockCopyButton />
              </CodeBlockActions>
            </CodeBlockHeader>
          </CodeBlock>

          {/* Turn metrics */}
          <div className="flex items-center gap-3 text-[10px] tabular-nums text-zinc-600">
            <span>In: {fmt(turn.inputTokens, 'tok')}</span>
            <span>Out: {fmt(turn.outputTokens, 'tok')}</span>
            <span>{fmt(turn.durationMs, 'ms')}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────

export function FlowCaseDetail({ steps, onClose }: FlowCaseDetailProps) {
  return (
    <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg px-4 py-3 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Step Detail</span>
        {onClose && (
          <button
            onClick={onClose}
            className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors leading-none"
          >
            &times;
          </button>
        )}
      </div>

      {/* Cost Breakdown */}
      <CostBar steps={steps} />

      {/* Step Timeline */}
      <div className="space-y-2">
        {steps.map((step, i) => (
          <StepCard key={step.id} step={step} colorIdx={i} />
        ))}
      </div>
    </div>
  )
}
