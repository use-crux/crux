/**
 * Quality Workbench navigation map.
 *
 * Sidebar layout: two Quality groups (Inspect / Evaluate) plus a Library
 * group for browseable Crux primitives & state. Inspect is the observability
 * side (Overview · Insights · Runs · Feedback); Evaluate is the measurement
 * side (Evaluations · Experiments · Baselines · Cassettes · Scorers).
 */

export type QwViewId =
  | 'overview'
  | 'insights'
  | 'runs'
  | 'feedback'
  | 'evaluations'
  | 'experiments'
  | 'baselines'
  | 'cassettes'
  | 'scorers'
  | 'library-index'
  | 'library-memory'
  | 'library-workspaces'
  | 'library-plans'

export interface QwNavItem {
  id: QwViewId
  label: string
  iconName: IconName
}

export interface QwNavGroup {
  id: string
  label: string
  items: QwNavItem[]
}

export type IconName =
  | 'home'
  | 'sparkle'
  | 'trace'
  | 'layers'
  | 'flask'
  | 'compare'
  | 'bookmark'
  | 'inbox'
  | 'cassette'
  | 'filter'
  | 'search'
  | 'play'
  | 'arrowRight'
  | 'arrowDown'
  | 'arrowUp'
  | 'check'
  | 'x'
  | 'loop'
  | 'spark'
  | 'alert'
  | 'diff'
  | 'more'
  | 'book'
  | 'brain'
  | 'folder'
  | 'list'
  | 'tasks'
  | 'doc'
  | 'link'
  | 'db'
  | 'grid'
  | 'clock'
  | 'user'
  | 'branch'
  | 'bot'
  | 'info'

export const QW_NAV: QwNavGroup[] = [
  {
    id: 'inspect',
    label: 'Inspect',
    items: [
      { id: 'overview', label: 'Overview', iconName: 'home' },
      { id: 'insights', label: 'Insights', iconName: 'sparkle' },
      { id: 'runs', label: 'Runs', iconName: 'trace' },
      { id: 'feedback', label: 'Feedback', iconName: 'inbox' },
    ],
  },
  {
    id: 'evaluate',
    label: 'Evaluate',
    items: [
      { id: 'evaluations', label: 'Evaluations', iconName: 'layers' },
      { id: 'experiments', label: 'Experiments', iconName: 'flask' },
      { id: 'baselines', label: 'Baselines', iconName: 'bookmark' },
      { id: 'cassettes', label: 'Cassettes', iconName: 'cassette' },
      { id: 'scorers', label: 'Scorers', iconName: 'spark' },
    ],
  },
  {
    id: 'library',
    label: 'Library',
    items: [
      { id: 'library-index', label: 'Index', iconName: 'book' },
      { id: 'library-memory', label: 'Memory', iconName: 'brain' },
      { id: 'library-workspaces', label: 'Workspaces', iconName: 'folder' },
      { id: 'library-plans', label: 'Plans & Tasks', iconName: 'tasks' },
    ],
  },
]
