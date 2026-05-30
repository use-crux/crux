/**
 * Centralized store key namespace.
 *
 * All CruxStore key patterns in one place. Modules import key builders
 * from here instead of scattering string literals across the codebase.
 *
 * @module
 */

/**
 * Store key namespace registry.
 *
 * Each namespace provides:
 * - `key(...)` — build a full key from identifiers
 * - `prefix` — the constant prefix for list/scan operations
 *
 * Prefixes are guaranteed non-overlapping within the registry.
 */
export const keySpace = {
  /** Plan documents: `plan:{planId}` */
  plan: {
    key: (id: string) => `plan:${id}`,
    prefix: 'plan:' as const,
  },
  /** Task lists: `tasklist:{taskListId}` */
  taskList: {
    key: (id: string) => `tasklist:${id}`,
    prefix: 'tasklist:' as const,
  },
  /** Individual tasks: `task:{taskListId}:{taskId}` */
  task: {
    key: (listId: string, taskId: string) => `task:${listId}:${taskId}`,
    prefix: (listId: string) => `task:${listId}:` as const,
  },
  /** Flow snapshots: `crux:flow:{flowId}` */
  flow: {
    key: (id: string) => `crux:flow:${id}`,
    prefix: 'crux:flow:' as const,
  },
  /** Flow signals: `crux:signal:{flowId}:{signalName}` */
  signal: {
    key: (flowId: string, name: string) => `crux:signal:${flowId}:${name}`,
    prefix: (flowId: string) => `crux:signal:${flowId}:` as const,
  },
  /** Blackboard state: `blackboard:{boardId}` */
  blackboard: {
    key: (id: string) => `blackboard:${id}`,
    prefix: 'blackboard:' as const,
  },
} as const
