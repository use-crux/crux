import { safeId } from '../definitions'
import type { IndexExtractor, UnresolvedReference } from '../extensions'
import { facts } from '../extensions'
import type { ProjectSourceRefRole } from '@crux/core/project-index'

/**
 * Extracts constraint and guardrail definitions from safety primitives.
 *
 * Safety extractors preserve validator/policy source refs and normalize `appliesTo`-style fields into
 * unresolved references so relation resolution can connect policies to protected index definitions.
 */
export const safetyIndexExtractor: IndexExtractor = {
  name: 'safety',
  patterns: [
    { kind: 'call', name: 'constraint' },
    { kind: 'call', name: 'guardrail' },
  ],
  extract: (ctx) => {
    if (!ctx.config) return { kind: 'none' }
    if (ctx.match.name === 'constraint') {
      const explicitName = ctx.config.string('name')
      const id = `constraint:${safeId(explicitName ?? ctx.source.localName)}`
      const targets = appliesToRefs(ctx.config)
      return facts({
        definitions: [
          ctx.define.definition({
            variableName: ctx.source.variableName,
            id,
            kind: 'constraint',
            name: explicitName ?? ctx.source.variableName,
            metadata: {
              exportName: ctx.source.variableName,
              severity: ctx.config.string('severity'),
              appliesTo: targets.metadata,
              facts: {
                kind: 'constraint',
                severity: ctx.config.string('severity'),
                appliesTo: targets.metadata,
              },
            },
          }),
        ],
        sourceRefs: validatorSourceRefs(ctx, id, 'validator'),
        references: targets.refs.map((target) => ({ type: 'constraint.applies_to', ...target })),
      })
    }
    if (ctx.match.name === 'guardrail') {
      const explicitName = ctx.config.string('name')
      const id = `guardrail:${safeId(explicitName ?? ctx.source.localName)}`
      const targets = appliesToRefs(ctx.config)
      return facts({
        definitions: [
          ctx.define.definition({
            variableName: ctx.source.variableName,
            id,
            kind: 'guardrail',
            name: explicitName ?? ctx.source.variableName,
            metadata: {
              exportName: ctx.source.variableName,
              phase: ctx.config.string('phase'),
              appliesTo: targets.metadata,
              facts: {
                kind: 'guardrail',
                policy: ctx.config.string('phase'),
                appliesTo: targets.metadata,
              },
            },
          }),
        ],
        sourceRefs: validatorSourceRefs(ctx, id, 'policy'),
        references: targets.refs.map((target) => ({ type: 'guardrail.applies_to', ...target })),
      })
    }
    return { kind: 'none' }
  },
}

/** Collects callback source refs for validator or policy functions on safety definitions. */
function validatorSourceRefs(
  ctx: Parameters<IndexExtractor['extract']>[0],
  definitionId: string,
  role: ProjectSourceRefRole,
) {
  return ['check', 'run', 'validate', 'evaluate']
    .map((property) => ctx.sourceRef.callbackProperty({ property, role, definitionId }))
    .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
}

/**
 * Normalizes all supported target fields into unresolved references plus display metadata.
 *
 * Identifier targets are treated as variables/imports for resolver binding; string targets containing
 * a index-id separator are treated as direct ids.
 */
function appliesToRefs(config: NonNullable<Parameters<IndexExtractor['extract']>[0]['config']>): {
  readonly refs: ReadonlyArray<Pick<UnresolvedReference, 'toVariable' | 'toId'>>
  readonly metadata?: readonly string[]
} {
  const names = ['appliesTo', 'target', 'targets', 'for']
  const refs = names.flatMap((name): Array<Pick<UnresolvedReference, 'toVariable' | 'toId'>> => {
    const single = config.identifier(name)
    return [
      ...(single ? [{ toVariable: single }] : []),
      ...config.identifierArray(name).map((item) => ({ toVariable: item })),
      ...config.stringArray(name).map((item) =>
        item.includes(':') ? { toId: item } : { toVariable: item },
      ),
    ]
  })
  const metadata = names.flatMap((name) => [
    ...[config.identifier(name)].filter(isString),
    ...config.identifierArray(name),
    ...config.stringArray(name),
  ])
  return { refs, ...(metadata.length > 0 ? { metadata } : {}) }
}

/** Removes absent optional target values while preserving authored empty strings if they are ever allowed. */
function isString(value: string | undefined): value is string {
  return typeof value === 'string'
}
