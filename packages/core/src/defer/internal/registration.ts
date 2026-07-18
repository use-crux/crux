/** Lazy deferred-work capability for active Crux primitive scopes. */

import { currentScope, resolveConfiguredHost } from '../../scope/kernel'
import type { ExecutionScope } from '../../scope/contracts'
import { bindRootRetention } from '../../scope/state'
import {
  currentDeferRegistration,
  currentScopeDeferController,
  type DeferRegistrationContext,
} from './context'
import {
  createScopeDeferController,
  type ScopeDeferController,
} from './invocation-scope'
import { createPrimitiveDeferServices } from './invocation-services'

/**
 * Resolve an explicit invocation override or lazily bootstrap the active
 * primitive root on first registration.
 */
export function resolveDeferRegistration():
  | DeferRegistrationContext
  | undefined {
  const explicit = currentDeferRegistration()
  if (explicit) return explicit

  const scope = currentScope()
  if (!scope) return undefined

  const inheritedController = currentScopeDeferController()
  const controller =
    inheritedController ?? createPrimitiveRootController(scope.root)
  return Object.freeze({
    scope: controller,
    phase: 'handler' as const,
    depth: 0,
  })
}

/** Attach configured capabilities and lazily create one primitive-root controller. */
function createPrimitiveRootController(
  rootScope: ExecutionScope,
): ScopeDeferController {
  const binding = resolveConfiguredHost()
  if (binding) bindRootRetention(rootScope, binding)
  return createScopeDeferController(
    rootScope,
    createPrimitiveDeferServices(rootScope, binding),
  )
}
