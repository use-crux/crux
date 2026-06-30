/**
 * The Run Detail `Explain` tab — the runtime plane's read-out of one model turn.
 *
 * Verdict-led, then a scannable body that answers the six debugging questions
 * and links into the existing deep tabs (Context, Routing, Cache, …) rather than
 * duplicating them. Bound to the live {@link TurnDecisionReport}; every honest
 * state (missing / unknown / unresolved) renders rather than blanking.
 *
 * This component owns only ephemeral view state (scroll target + flash). Which
 * tab is active and the default-tab choice live in the parent generation detail
 * pane; deep-tab links call back through {@link onOpenTab}.
 */

import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { summaryChips, type ExplainSection } from '@/features/run-detail/lib/explain/chips'
import { normalizeTurnDecisionReport, type RuntimeTurnDecisionReport } from '@/features/run-detail/lib/explain/report'
import { resolveOpenTab, type ExplainGenTab } from '@/features/run-detail/lib/explain/tabs'
import type { TurnDeepTabTarget } from '@/types'
import { SecBand } from './band'
import { VerdictBand } from './sections/VerdictBand'
import { ConsideredRow, SawRow } from './sections/EvidenceSection'
import { FreshCacheBlock } from './sections/FreshCache'
import { DecisionRow } from './sections/Decisions'
import { SourceGroups } from './sections/Sources'
import { ProtectBlock } from './sections/Protect'
import { GapsBlock } from './sections/Gaps'

/** A bordered card wrapping a list of rows. */
function Card({ children }: { children: ReactNode }) {
  return (
    <div
      className="mb-1 overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg)', border: '1px solid var(--qw-border)' }}
    >
      {children}
    </div>
  )
}

/**
 * A jump-target section wrapper. Module-level (not defined in render) so the
 * sections — and their scroll refs — are stable across flash-state changes.
 */
function Sec({
  id,
  flash,
  register,
  children,
}: {
  id: ExplainSection
  flash: ExplainSection | null
  register: (id: ExplainSection, el: HTMLDivElement | null) => void
  children: ReactNode
}) {
  return (
    <div
      ref={(el) => register(id, el)}
      className="mb-7 rounded-[10px] transition-shadow"
      style={{ scrollMarginTop: 14, boxShadow: flash === id ? '0 0 0 2px var(--qw-crux-line)' : 'none' }}
    >
      {children}
    </div>
  )
}

export function ExplainTab({
  report,
  availableTabs,
  onOpenTab,
}: {
  report: RuntimeTurnDecisionReport
  /** Tab ids present on this turn — gates which deep links are live. */
  availableTabs: readonly string[]
  /** Switch the generation detail pane to a deep tab. */
  onOpenTab: (tab: ExplainGenTab) => void
}) {
  const normalized = normalizeTurnDecisionReport(report)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Partial<Record<ExplainSection, HTMLDivElement | null>>>({})
  const [flash, setFlash] = useState<ExplainSection | null>(null)

  const jump = useCallback((section: ExplainSection) => {
    const el = sectionRefs.current[section]
    const scroller = scrollRef.current
    if (el && scroller) scroller.scrollTo({ top: Math.max(0, el.offsetTop - 14), behavior: 'smooth' })
    setFlash(section)
    window.setTimeout(() => setFlash((f) => (f === section ? null : f)), 1300)
  }, [])

  /** A click handler that opens a deep tab, or undefined when it is absent. */
  const linkTo = useCallback(
    (target: TurnDeepTabTarget | undefined): (() => void) | undefined => {
      const id = resolveOpenTab(target?.tab, availableTabs)
      return id ? () => onOpenTab(id) : undefined
    },
    [availableTabs, onOpenTab],
  )
  const openContext = useCallback(
    () => linkTo({ tab: 'Context' })?.(),
    [linkTo],
  )
  const contextLink = resolveOpenTab('Context', availableTabs) ? openContext : undefined

  const register = useCallback((id: ExplainSection, el: HTMLDivElement | null) => {
    sectionRefs.current[id] = el
  }, [])

  if (!normalized) return null

  const chips = summaryChips(normalized)
  const droppedSome = normalized.considered.some((c) => c.disposition === 'dropped')
  const uncovered = normalized.coverage.covered < normalized.coverage.total

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto px-6 py-5" style={{ maxWidth: 960 }}>
        <VerdictBand verdict={normalized.turn.verdict} chips={chips} activeJump={flash} onJump={jump} />

        <Sec id="saw" flash={flash} register={register}>
          <SecBand
            icon="doc"
            title="What the model saw"
            count={`${normalized.saw.length} items`}
            hint="present in the rendered request"
            right={contextLink ? <OpenContext onClick={contextLink} /> : undefined}
          />
          <Card>
            {normalized.saw.length === 0 ? (
              <Empty>Nothing was recorded as reaching the model for this turn.</Empty>
            ) : (
              normalized.saw.map((item, i) => <SawRow key={item.id ?? i} item={item} onOpen={contextLink} />)
            )}
          </Card>
        </Sec>

        <Sec id="considered" flash={flash} register={register}>
          <SecBand
            icon="search"
            title="Checked but not sent"
            count={`${normalized.considered.length} candidates`}
            hint="evaluated, did not reach the model"
            tone={droppedSome ? 'warn' : 'muted'}
          />
          <Card>
            {normalized.considered.length === 0 ? (
              <Empty>Every evaluated candidate reached the model.</Empty>
            ) : (
              normalized.considered.map((item, i) => <ConsideredRow key={item.id ?? i} item={item} />)
            )}
          </Card>
        </Sec>

        <Sec id="fresh" flash={flash} register={register}>
          <SecBand icon="clock" title="Freshness & cache" hint="two different questions — kept apart on purpose" />
          <FreshCacheBlock freshness={normalized.freshness} cache={normalized.cache} />
        </Sec>

        <Sec id="decisions" flash={flash} register={register}>
          <SecBand
            icon="branch"
            title="Decisions"
            count={`${normalized.decisions.length}`}
            hint="runtime control folded into this turn"
          />
          <Card>
            {normalized.decisions.length === 0 ? (
              <Empty>No runtime decisions were folded onto this turn.</Empty>
            ) : (
              normalized.decisions.map((d) => <DecisionRow key={d.id} decision={d} onOpen={linkTo(d.tab)} />)
            )}
          </Card>
        </Sec>

        <Sec id="source" flash={flash} register={register}>
          <SecBand icon="link" title="What source do I change?" hint="definitions that shaped this turn" />
          <SourceGroups groups={normalized.source} />
        </Sec>

        <Sec id="protect" flash={flash} register={register}>
          <SecBand
            icon="spark"
            title="How this is protected"
            hint="quality coverage & gaps worth testing"
            tone={uncovered ? 'warn' : 'ok'}
          />
          <ProtectBlock coverage={normalized.coverage} />
        </Sec>

        <Sec id="gaps" flash={flash} register={register}>
          <SecBand
            icon="info"
            title="Missing evidence"
            count={normalized.gaps.length ? `${normalized.gaps.length}` : undefined}
            hint="what Crux could not prove from recorded data"
          />
          <GapsBlock gaps={normalized.gaps} />
        </Sec>
      </div>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="px-3.5 py-3 text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
      {children}
    </div>
  )
}

function OpenContext({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 font-mono text-[10.5px]"
      style={{ color: 'var(--qw-crux)' }}
    >
      open Context
    </button>
  )
}
