/**
 * Quality Workbench navigation map.
 *
 * Sidebar layout: three Quality groups (Inspect / Evaluate / Loop),
 * a Library group for browseable Crux primitives & state, and a pinned
 * Scorers & gates entry at the bottom.
 */

export type QwViewId =
  | 'overview'
  | 'insights'
  | 'runs'
  | 'datasets'
  | 'experiments'
  | 'compare'
  | 'baselines'
  | 'feedback'
  | 'cassettes'
  | 'scorers'
  | 'library-catalog'
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

export const QW_NAV: QwNavGroup[] = [
  {
    id: 'inspect',
    label: 'Inspect',
    items: [
      { id: 'overview', label: 'Overview', iconName: 'home' },
      { id: 'insights', label: 'Insights', iconName: 'sparkle' },
      { id: 'runs', label: 'Runs', iconName: 'trace' },
    ],
  },
  {
    id: 'evaluate',
    label: 'Evaluate',
    items: [
      { id: 'datasets', label: 'Suites', iconName: 'layers' },
      { id: 'experiments', label: 'Experiments', iconName: 'flask' },
      { id: 'compare', label: 'Compare', iconName: 'compare' },
      { id: 'baselines', label: 'Baselines', iconName: 'bookmark' },
    ],
  },
  {
    id: 'loop',
    label: 'Loop',
    items: [
      { id: 'feedback', label: 'Feedback', iconName: 'inbox' },
      { id: 'cassettes', label: 'Cassettes', iconName: 'cassette' },
    ],
  },
  {
    id: 'library',
    label: 'Library',
    items: [
      { id: 'library-catalog', label: 'Catalog', iconName: 'book' },
      { id: 'library-memory', label: 'Memory', iconName: 'brain' },
      { id: 'library-workspaces', label: 'Workspaces', iconName: 'folder' },
      { id: 'library-plans', label: 'Plans & Tasks', iconName: 'tasks' },
    ],
  },
]
