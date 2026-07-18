import type { GuardrailAudit, GuardrailContext } from '../guardrail/types'
import type { MediaGroupDependency } from '../media/groups'
import { visitMedia, type MediaVisitGroup, type MediaVisitItem, type MediaVisitResult } from '../media/visit'
import type { GuardrailBinding } from '../registry'

interface GuardInputOperationMediaOptions {
  readonly bindings: readonly GuardrailBinding[]
  readonly items: readonly MediaVisitItem[]
  readonly groups: readonly MediaVisitGroup[]
  readonly dependencies?: readonly MediaGroupDependency[]
  readonly context: GuardrailContext
  readonly appendAudit: (audit: GuardrailAudit) => void
}

/** Guard canonical completed-operation input media without message projection. */
export function guardInputOperationMedia(options: GuardInputOperationMediaOptions): Promise<MediaVisitResult> {
  return visitMedia({
    phase: 'input',
    bindings: options.bindings,
    items: options.items,
    groups: options.groups,
    dependencies: options.dependencies,
    context: () => options.context,
    appendAudit: options.appendAudit,
  })
}
