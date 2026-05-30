/**
 * `@crux/react` — Reactive hooks for plans and task lists.
 *
 * Transport-agnostic: works with Convex, SSE, polling, or any custom transport.
 * Wrap your app with `<CruxProvider transport={...}>` and use the domain hooks.
 *
 * @example
 * ```tsx
 * import { CruxProvider, usePlan, useTaskList, useTasks } from '@crux/react'
 * import { createConvexTransport } from '@crux/convex/react'
 *
 * // Setup
 * <CruxProvider transport={createConvexTransport(api)}>
 *   <App />
 * </CruxProvider>
 *
 * // In components
 * function PlanView({ planId }: { planId: string }) {
 *   const plan = usePlan(planId)
 *   const taskList = useTaskList({ planId })
 *   const tasks = useTasks(taskList?.id)
 *   // ...
 * }
 * ```
 *
 * @module
 */

// Provider
export { CruxProvider, useCruxTransport } from './provider'

// Domain hooks
export { usePlan, useTaskList, useTasks, useBlackboard, useWorkingMemory } from './hooks'

// Transports
export { createPollingTransport } from './polling'
export type { PollingTransport, PollingTransportOptions } from './polling'
export { createSSETransport } from './sse'
export type { SSETransport, SSETransportOptions } from './sse'

// Testing utilities
export { createMockTransport } from './testing'
export type { MockTransport } from './testing'

// Transport type
export type { CruxTransport } from './types'
