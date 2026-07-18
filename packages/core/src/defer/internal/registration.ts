/** Lazy deferred-work capability for active Crux primitive scopes. */

import { currentScope } from '../../scope/kernel'
import {
  currentDeferRegistration,
  currentScopeDeferController,
  type DeferRegistrationContext,
} from './context'
import { createScopeDeferController } from './invocation-scope'
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

  const controller =
    currentScopeDeferController() ??
    createScopeDeferController(
      scope.root,
      createPrimitiveDeferServices(scope.root),
    )
  return Object.freeze({
    scope: controller,
    phase: 'handler' as const,
    depth: 0,
  })
}
