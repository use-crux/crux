/**
 * "How this is protected" — the coverage gauge plus a per-area scorecard.
 * Uncovered areas show a **read-only** suggested assertion (dashed mono) and an
 * optional copyable CLI hint. The UI never fakes a "create test" write: tests
 * are authored in code and run from the CLI, matching the Quality plane.
 */

import { Icon } from '@/qw/shell/Icon'
import type { TurnDecisionCoverage } from '@/types'
import { CoverageChip, CoverageGauge } from '../atoms'

export function ProtectBlock({ coverage }: { coverage: TurnDecisionCoverage }) {
  return (
    <div
      className="overflow-hidden rounded-[12px]"
      style={{ background: 'var(--qw-bg)', border: '1px solid var(--qw-border)' }}
    >
      <div className="px-4 py-3.5" style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg-elev)' }}>
        <CoverageGauge covered={coverage.covered} total={coverage.total} />
      </div>
      {coverage.areas.map((a, i) => (
        <div
          key={a.id}
          className="flex items-center gap-3 px-4 py-2.5"
          style={{ borderBottom: i < coverage.areas.length - 1 ? '1px solid var(--qw-border)' : 'none' }}
        >
          <span className="w-[170px] flex-shrink-0 text-[12.5px] font-medium" style={{ color: 'var(--qw-fg)' }}>
            {a.label}
          </span>
          <span className="w-[132px] flex-shrink-0">
            <CoverageChip status={a.status} />
          </span>
          {a.suggestion ? (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-[12.5px] italic" style={{ fontFamily: 'var(--qw-serif)', color: 'var(--qw-fg-muted)' }}>
                suggest
              </span>
              <span
                className="min-w-0 flex-1 truncate font-mono text-[11px]"
                style={{
                  color: 'var(--qw-fg)',
                  background: 'var(--qw-bg-muted)',
                  border: '1px dashed var(--qw-border-strong)',
                  borderRadius: 5,
                  padding: '2px 8px',
                }}
                title={a.command ? `${a.suggestion} — ${a.command}` : a.suggestion}
              >
                {a.suggestion}
              </span>
            </span>
          ) : (
            <span className="flex-1" />
          )}
        </div>
      ))}
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: 'var(--qw-bg-elev)' }}>
        <Icon name="info" size={12} color="var(--qw-fg-faint)" />
        <span className="text-[11.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
          Suggestions are read-only. Assertions are authored in code, then run from the CLI.
        </span>
      </div>
    </div>
  )
}
