/**
 * `@use-crux/react` — Reactive hooks for plans and tasks.
 *
 * Transport-agnostic: works with Convex, SSE, polling, or any custom transport.
 * Wrap your app with `<CruxProvider transport={...}>` and use the domain hooks.
 *
 * @example
 * ```tsx
 * import { CruxProvider, usePlan, useTasks } from '@use-crux/react'
 * import { defineConvexStoreContract } from '@use-crux/convex'
 * import { useQuery } from 'convex/react'
 * import { components } from '../convex/_generated/api'
 *
 * const cruxDocuments = defineConvexStoreContract({ component: components.crux })
 *
 * <CruxProvider transport={cruxDocuments.transport({ useQuery })}>
 *   <App />
 * </CruxProvider>
 *
 * // In components
 * function PlanView({ planId, taskListId }: { planId: string; taskListId: string }) {
 *   const plan = usePlan(planId)
 *   const taskItems = useTasks(taskListId)
 *   // ...
 * }
 * ```
 *
 * @module
 */

// Provider
export { CruxProvider, useCruxTransport } from './provider'

// Domain hooks
export { usePlan, useTasks, useBlackboard, useWorkingMemory } from './hooks'

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
