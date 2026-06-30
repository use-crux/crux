import type { Storage } from '@use-crux/core/storage'
import { assertConvexCtxPort, createDefaultConvexStorage } from '../profile-store'
import type { ComponentApi } from '../src/component/_generated/component'

/** Create the default request-scoped Crux storage for profile-backed agent turns. */
export async function defaultConvexAgentStorage(component: ComponentApi | undefined, ctx: unknown): Promise<Storage> {
  if (!component) {
    throw new Error('convexAgent() requires components.crux or custom storage to bind Crux runtime state.')
  }
  assertConvexCtxPort(ctx)
  return createDefaultConvexStorage(ctx, { component })
}
