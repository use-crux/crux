import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RuntimeTurnDecisionReport } from '@/features/run-detail/lib/explain/report'
import { ExplainTab } from './ExplainTab'

describe('ExplainTab', () => {
  it('renders a partial report whose empty collections arrived as null', () => {
    const report = {
      schemaVersion: 1,
      reportId: 'tdr:run:gen',
      runId: 'run',
      turn: {
        id: 'gen',
        kind: 'generation.call',
        status: 'ok',
        verdict: 'Answered with request composition evidence unavailable.',
      },
      saw: [],
      considered: null,
      freshness: [],
      cache: null,
      decisions: [],
      source: [{ group: 'Contexts', items: null }],
      coverage: { covered: 0, total: 6, areas: null },
      gaps: null,
      summary: null,
    } satisfies RuntimeTurnDecisionReport

    const html = renderToStaticMarkup(
      <ExplainTab report={report} availableTabs={['explain', 'output', 'context']} onOpenTab={() => {}} />,
    )

    expect(html).toContain('What the model saw')
    expect(html).toContain('Checked but not sent')
    expect(html).toContain('Freshness')
    expect(html).toContain('How this is protected')
  })
})
