import type { CruxStore } from '@use-crux/core/store'
import { assertConvexCtxPort, createDefaultConvexCruxStore } from '../profile-store'
import type { ComponentApi } from '../src/component/_generated/component'

/** Create the default request-scoped Crux store for profile-backed agent turns. */
export async function defaultConvexAgentStore(component: ComponentApi | undefined, ctx: unknown): Promise<CruxStore> {
  if (!component) {
    throw new Error('convexAgent() requires components.crux or a custom store to bind Crux runtime state.')
  }
  assertConvexCtxPort(ctx)
  return createDefaultConvexCruxStore(ctx, { component })
}
