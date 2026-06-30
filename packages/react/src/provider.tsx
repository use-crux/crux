/**
 * CruxProvider — React context for transport injection.
 *
 * Wrap your app with `<CruxProvider transport={...}>` to make domain hooks
 * (`usePlan`, `useTasks`) available to all child components.
 *
 * @module
 */

import React, { createContext, useContext, type ReactNode } from 'react'
import type { CruxTransport } from './types'

const CruxContext = createContext<CruxTransport | null>(null)

/**
 * Provide a `CruxTransport` to all child components.
 *
 * @example
 * ```tsx
 * import { CruxProvider } from '@use-crux/react'
 * import { createConvexTransport } from '@use-crux/convex'
 * import { useQuery } from 'convex/react'
 * import { components } from '../convex/_generated/api'
 *
 * const transport = createConvexTransport({ api: components.crux, useQuery })
 *
 * <CruxProvider transport={transport}>
 *   <App />
 * </CruxProvider>
 * ```
 */
export function CruxProvider({ transport, children }: { transport: CruxTransport; children: ReactNode }) {
  return <CruxContext.Provider value={transport}>{children}</CruxContext.Provider>
}

/**
 * Access the current `CruxTransport` from context.
 *
 * @throws If called outside a `<CruxProvider>`.
 */
export function useCruxTransport(): CruxTransport {
  const transport = useContext(CruxContext)
  if (!transport) {
    throw new Error('useCruxTransport: no CruxProvider found. Wrap your app with <CruxProvider transport={...}>.')
  }
  return transport
}
