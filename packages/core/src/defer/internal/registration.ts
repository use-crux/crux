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

/**
 * Resolve callback registration only when execution is safely retained or
 * intentionally captured by the active scope.
 *
 * Unlike {@link resolveDeferRegistration}, this diagnostics-only boundary
 * never bootstraps an unretained callback controller. Callers can therefore
 * use absence as the signal to execute correctness-critical work inline.
 */
export function resolveDiagnosticsOnlyDeferRegistration():
  | DeferRegistrationContext
  | undefined {
  const explicit = currentDeferRegistration()
  const scope = currentScope()
  const capturesCallbacks = scope?.policies.drain === 'capture'

  if (explicit) {
    return explicit.scope.callbackRetention === 'retained' || capturesCallbacks
      ? explicit
      : undefined
  }
  if (!scope) return undefined

  const inheritedController = currentScopeDeferController()
  if (inheritedController) {
    return inheritedController.callbackRetention === 'retained' || capturesCallbacks
      ? registrationFor(inheritedController)
      : undefined
  }

  if (capturesCallbacks) {
    return registrationFor(createPrimitiveRootController(scope.root))
  }

  const binding = resolveConfiguredHost()
  if (!binding || binding.supportsInline === false) return undefined
  return registrationFor(createPrimitiveRootController(scope.root, binding))
}

/** Attach configured capabilities and lazily create one primitive-root controller. */
function createPrimitiveRootController(
  rootScope: ExecutionScope,
  binding = resolveConfiguredHost(),
): ScopeDeferController {
  if (binding) bindRootRetention(rootScope, binding)
  return createScopeDeferController(
    rootScope,
    createPrimitiveDeferServices(rootScope, binding),
  )
}

function registrationFor(
  scope: ScopeDeferController,
): DeferRegistrationContext {
  return Object.freeze({ scope, phase: 'handler' as const, depth: 0 })
}
