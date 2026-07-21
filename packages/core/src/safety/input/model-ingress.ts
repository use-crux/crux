import { contentText } from '../../content'
import type { ContentPart } from '../../types/content'
import { latestRewritePolicyId } from '../audit'
import { SafetyResultError } from '../errors'
import { createGuardrailPipeline } from '../guardrail/pipeline'
import type { GuardrailAudit, GuardrailContext } from '../guardrail/types'
import type { ModelInputOrigin } from '../input-origin'
import type { MediaVisitGroup, MediaVisitItem } from '../media/visit'
import { visitMedia } from '../media/visit'
import type { GuardrailBinding } from '../registry'
import { applyProjectedRewrite } from './projected-text'
import { inputBindingsFor } from './source'

/** @internal Privacy-safe provenance for canonical tool output. */
export type ToolModelInputOrigin = Extract<ModelInputOrigin, { readonly source: 'tool' }>

/** @internal Canonical text crossing a semantic model-ingress boundary. */
export interface CanonicalTextIngress {
  readonly kind: 'text'
  readonly value: string
  readonly origin: ModelInputOrigin
}

/** @internal Canonical content crossing a semantic model-ingress boundary. */
export interface CanonicalContentIngress {
  readonly kind: 'content'
  readonly value: readonly ContentPart[]
  readonly origin: ToolModelInputOrigin
}

/** @internal Result of guarding one canonical model-ingress value. */
export interface CanonicalContentIngressResult {
  readonly kind: 'content'
  readonly value: readonly ContentPart[]
}

/** @internal Guarded canonical text ready for model delivery. */
export interface CanonicalTextIngressResult {
  readonly kind: 'text'
  readonly value: string
}

/** @internal Canonical values accepted by the semantic model-ingress gate. */
export type CanonicalModelIngress = CanonicalTextIngress | CanonicalContentIngress

/** @internal Sanitized canonical values returned by the model-ingress gate. */
export type CanonicalModelIngressResult = CanonicalTextIngressResult | CanonicalContentIngressResult

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

  return guardContentIngress({ ...options, input: options.input })
}

async function guardContentIngress(
  options: GuardModelIngressOptions & { readonly input: CanonicalContentIngress },
): Promise<CanonicalContentIngressResult> {
  let value = options.input.value
  const mediaBindings = inputBindingsFor(options.bindings, 'model.input.media', options.input.origin.source)

  if (mediaBindings.length > 0) {
    const projection = projectContent(options.input)
    if (projection.items.length > 0) {
      const stripped = new Set<number>()
      await visitMedia({
        phase: 'input',
        bindings: mediaBindings,
        items: projection.items,
        groups: projection.groups,
        context: ({ subject }) => ({
          ...options.context,
          origin: { ...options.input.origin, partIndex: subject.origin.partIndex },
        }),
        appendAudit: options.appendAudit,
        onStrip: ({ subject }) => stripped.add(subject.origin.partIndex),
      })
      if (stripped.size > 0) {
        value = value.filter((_part, partIndex) => !stripped.has(partIndex))
      }
    }
  }

  const textBindings = inputBindingsFor(options.bindings, 'model.input.text', options.input.origin.source)
  if (textBindings.length === 0) {
    return value === options.input.value ? options.input : { kind: 'content', value }
  }

  const originalProjection = contentText(value)
  const result = await createGuardrailPipeline(textBindings).runInput(originalProjection, {
    ...options.context,
    origin: options.input.origin,
  })
  options.appendAudit(result.audit)
  if (result.content === originalProjection) {
    return value === options.input.value ? options.input : { kind: 'content', value }
  }

  const rewritten = applyProjectedRewrite(value, originalProjection, result.content)
  if (!Array.isArray(rewritten)) {
    const policyId = latestRewritePolicyId(result.audit.applied) ?? 'unknown'
    throw new SafetyResultError({
      policyId,
      boundary: 'model.input.text',
      problem: 'rewrite could not be faithfully applied to canonical tool content',
      message:
        `Safety policy "${policyId}" rewrote a tool-output projection that no longer aligns with its media placeholders. ` +
        'Media placeholders must be preserved verbatim by rewrites; policies that need to act on media sources should block instead.',
    })
  }

  return { kind: 'content', value: rewritten }
}

function projectContent(input: CanonicalContentIngress): {
  readonly items: readonly MediaVisitItem[]
  readonly groups: readonly MediaVisitGroup[]
} {
  const items: MediaVisitItem[] = []
  for (let partIndex = 0; partIndex < input.value.length; partIndex++) {
    const part = input.value[partIndex]
    if (!part || part.type === 'text') continue
    items.push({
      groupId: 'tool-content',
      subject: {
        part,
        origin: {
          kind: 'tool-result',
          toolName: input.origin.toolName,
          toolCallId: input.origin.toolCallId,
          partIndex,
        },
      },
    })
  }
  return {
    items,
    groups: [{ id: 'tool-content', size: items.length, minimumRetained: 0 }],
  }
}
