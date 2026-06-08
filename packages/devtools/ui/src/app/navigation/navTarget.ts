import type { NavState } from '@/app/navigation/useNavigation'
import type { QwViewId } from '../../qw/shell/nav'

/**
 * Map a sidebar view id (issued by QwShell) to the canonical NavState.
 * Always lands on the list/index — drilldown state lives in URL params.
 */
export function navTarget(view: QwViewId | 'scorers'): NavState {
  switch (view) {
    case 'overview':
      return { view: 'overview' }
    case 'insights':
      return { view: 'insights' }
    case 'runs':
      return { view: 'runs' }
    case 'datasets':
      return { view: 'datasets' }
    case 'experiments':
      return { view: 'experiments' }
    case 'compare':
      return { view: 'compare' }
    case 'baselines':
      return { view: 'baselines' }
    case 'feedback':
      return { view: 'feedback' }
    case 'cassettes':
      return { view: 'cassettes' }
    case 'scorers':
      return { view: 'scorers' }
    case 'library-index':
      return { view: 'library-index' }
    case 'library-memory':
      return { view: 'library-memory' }
    case 'library-workspaces':
      return { view: 'library-workspaces' }
    case 'library-plans':
      return { view: 'library-plans' }
  }
}

/**
 * Resolve a breadcrumb segment label — as authored in each page's
 * `breadcrumb="Group / Label / …"` string — to the nav target for that
 * screen's list/index. Group headings (Inspect, Evaluate, Loop,
 * Library, Settings, Quality) and detail ids aren't screens you can
 * land on, so they return `null` and render as plain text.
 */
export function breadcrumbTarget(label: string): NavState | null {
  switch (label) {
    case 'Overview':
      return { view: 'overview' }
    case 'Insights':
      return { view: 'insights' }
    case 'Runs':
      return { view: 'runs' }
    case 'Suites':
      return { view: 'datasets' }
    case 'Experiments':
      return { view: 'experiments' }
    case 'Compare':
      return { view: 'compare' }
    case 'Baselines':
      return { view: 'baselines' }
    case 'Feedback':
      return { view: 'feedback' }
    case 'Cassettes':
      return { view: 'cassettes' }
    case 'Scorers & gates':
      return { view: 'scorers' }
    case 'Index':
      return { view: 'library-index' }
    case 'Memory':
      return { view: 'library-memory' }
    case 'Workspaces':
      return { view: 'library-workspaces' }
    case 'Plans':
      return { view: 'library-plans' }
    default:
      return null
  }
}
