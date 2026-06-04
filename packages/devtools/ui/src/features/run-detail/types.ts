/**
 * The four lenses over a run's structure. The lens changes how you navigate,
 * never the data. Shared across the run-detail shell and the URL/nav state.
 */
export type RunLens = 'tree' | 'timeline' | 'graph' | 'story'

export interface ReplayEventInput {
  who: string
  kind: string
  what: string
  detail?: string
  meta?: string
  body?: unknown
  notes?: string
  notesTone?: 'warn' | 'danger' | 'ok' | 'muted'
  payload?: ReplayEventPayload
  t: string
  tMs: number
  noise?: boolean
}

export type ReplayEventPayload =
  | { type: 'tool'; args?: unknown; result?: unknown; status?: string; error?: string }
  | { type: 'memory'; key?: string; value?: unknown; query?: string; resultCount?: number; operation?: string }
  | { type: 'retrieval'; query?: string; hits?: unknown; k?: number }
  | { type: 'handoff'; from?: string; to?: string; reason?: string; payload?: unknown }
  | { type: 'score'; score?: number; threshold?: number; rationale?: string; breakdown?: Record<string, number> }
  | { type: 'error'; message?: string; category?: string; stack?: string }
