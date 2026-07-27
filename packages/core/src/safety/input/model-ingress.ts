import { latestRewritePolicyId } from '../audit'
import { SafetyResultError } from '../errors'
import { createGuardrailPipeline } from '../guardrail/pipeline'
import type { GuardrailAudit, GuardrailContext } from '../guardrail/types'
import type {
  ModelInputOrigin,
  ModelInputOriginFor,
  TextInputSource,
} from '../input-origin'
import { visitMedia } from '../media/visit'
import type { GuardrailBinding } from '../registry'
import type {
  ModelIngressDocument,
  ModelIngressPatch,
  ModelIngressSlotKey,
} from './model-ingress-document'
import {
  emptyModelIngressPatch,
  patchModelIngressText,
  projectModelIngressSlots,
} from './model-ingress-projection'
import { inputBindingsFor } from './source'

/** @internal Privacy-safe provenance for canonical tool output. */
export type ToolModelInputOrigin = Extract<ModelInputOrigin, { readonly source: 'tool' }>

/** @internal Canonical text crossing a semantic model-ingress boundary. */
export interface CanonicalTextIngress {
  readonly kind: 'text'
  readonly value: string
  readonly origin: ModelInputOriginFor<TextInputSource>
}

/** @internal Guarded canonical text ready for model delivery. */
export interface CanonicalTextIngressResult {
  readonly kind: 'text'
  readonly value: string
}

/** @internal Canonical values accepted by the semantic model-ingress gate. */
export type CanonicalModelIngress = CanonicalTextIngress | ModelIngressDocument

/** @internal Sanitized canonical values returned by the model-ingress gate. */
export type CanonicalModelIngressResult = CanonicalTextIngressResult | ModelIngressPatch

/** @internal Core-owned semantic model-ingress capability. */
export interface ModelIngressGuard {
  (input: CanonicalModelIngress): Promise<CanonicalModelIngressResult>
}

interface GuardModelIngressOptions {
  readonly bindings: readonly GuardrailBinding[]
  readonly input: CanonicalModelIngress
  readonly context: GuardrailContext
  readonly appendAudit: (audit: GuardrailAudit) => void
}

/** Guard canonical model input after conversion and before provider writeback. */
export async function guardModelIngress(options: GuardModelIngressOptions): Promise<CanonicalModelIngressResult> {
  if (options.input.kind === 'text') {
    const bindings = inputBindingsFor(options.bindings, 'model.input.text', options.input.origin.source)
    if (bindings.length === 0) return options.input
    const result = await createGuardrailPipeline(bindings).runInput(options.input.value, {
      ...options.context,
      origin: options.input.origin,
    })
    options.appendAudit(result.audit)
    return { kind: 'text', value: result.content }
  }

  return guardDocumentIngress({ ...options, input: options.input })
}

async function guardDocumentIngress(
  options: GuardModelIngressOptions & { readonly input: ModelIngressDocument },
): Promise<ModelIngressPatch> {
  assertUniqueSlotKeys(options.input)
  const removed = new Set<ModelIngressSlotKey>()
  const mediaBindings = inputBindingsFor(options.bindings, 'model.input.media', options.input.origin.source)

  if (mediaBindings.length > 0) {
    const mediaSlots = options.input.slots.filter((slot) => slot.kind === 'media')
    if (mediaSlots.length > 0) {
      await visitMedia({
        phase: 'input',
        bindings: mediaBindings,
        items: mediaSlots.flatMap((slot) =>
          slot.subjects.map((subject) => ({
            subject,
            groupId: 'model-ingress',
            retentionKey: slot.key,
          })),
        ),
        groups: [{ id: 'model-ingress', size: mediaSlots.length, minimumRetained: 0 }],
        context: ({ subject }) => ({
          ...options.context,
          origin: { ...options.input.origin, partIndex: subject.origin.partIndex },
        }),
        appendAudit: options.appendAudit,
        onStrip: ({ retentionKey }) => {
          if (retentionKey !== undefined) removed.add(retentionKey)
        },
      })
    }
  }

  const textBindings = inputBindingsFor(options.bindings, 'model.input.text', options.input.origin.source)
  if (textBindings.length === 0) return { ...emptyModelIngressPatch(), removed }

  const originalProjection = projectModelIngressSlots(options.input.slots, removed)
  const result = await createGuardrailPipeline(textBindings).runInput(originalProjection, {
    ...options.context,
    origin: options.input.origin,
  })
  options.appendAudit(result.audit)
  if (result.content === originalProjection) {
    return { ...emptyModelIngressPatch(), removed }
  }

  const text = patchModelIngressText(options.input.slots, removed, result.content)
  if (!text) {
    const policyId = latestRewritePolicyId(result.audit.applied) ?? 'unknown'
    throw new SafetyResultError({
      policyId,
      boundary: 'model.input.text',
      problem: 'rewrite could not be faithfully applied to structured model input',
      message:
        `Safety policy "${policyId}" rewrote a model-input projection that no longer aligns with its media placeholders or opaque descriptors. ` +
        'Media and opaque descriptors must be preserved verbatim by rewrites; policies that need to act on protected content should block instead.',
    })
  }

  return { kind: 'patch', text, removed }
}

function assertUniqueSlotKeys(input: ModelIngressDocument): void {
  const keys = new Set<ModelIngressSlotKey>()
  for (const slot of input.slots) {
    if (keys.has(slot.key)) {
      throw new SafetyResultError({
        policyId: 'model-ingress',
        boundary: 'model.input.text',
        problem: 'model-ingress document contains duplicate slot keys',
        message: 'Structured model input could not be guarded because its private slot keys were not unique.',
      })
    }
    keys.add(slot.key)
  }
}
