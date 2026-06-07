import { safeId } from '../definitions'
import type { CatalogExtractor } from '../extensions'
import { facts } from '../extensions'

/**
 * Extracts scorer and judge definitions used by evaluations, consensus, and routing decisions.
 *
 * Scorer metadata is projected into catalog-friendly configuration facts so consumers can understand
 * scoring method/model/thresholds without executing the scorer.
 */
export const scorerCatalogExtractor: CatalogExtractor = {
  name: 'scorer',
  patterns: [{ kind: 'call', name: 'llmJudge' }],
  extract: (ctx) => {
    if (ctx.match.name !== 'llmJudge' || !ctx.config) return { kind: 'none' }
    const explicitId = ctx.config.string('id')
    const id = `scorer:${safeId(explicitId ?? ctx.source.localName)}`
    const model = ctx.config.string('model') ?? ctx.config.identifier('model')
    const threshold = ctx.config.number('threshold')
    const temperature = ctx.config.number('temperature')
    const samples = ctx.config.number('samples') ?? ctx.config.number('sampleCount')
    const scale = ctx.config.object('scale')
    const scaleMin = scale?.number('min')
    const scaleMax = scale?.number('max')
    const chainOfThought = ctx.config.boolean('chainOfThought')
    const criteriaPreview = ctx.config.string('criteria')
    const settings = objectRecord(ctx.config.json('settings'))
    const configuration = scorerConfiguration({
      model,
      threshold,
      temperature,
      samples,
      scaleMin,
      scaleMax,
      hasRubric: ctx.config.has('rubric'),
      hasDetailSchema: ctx.config.has('detailSchema'),
      chainOfThought,
      settings,
    })
    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'scorer',
          name: explicitId ?? ctx.source.variableName,
          metadata: {
            exportName: ctx.source.variableName,
            facts: {
              kind: 'scorer',
              scorerId: explicitId ?? ctx.source.variableName,
              ...(model ? { model } : {}),
              ...(threshold === undefined ? {} : { threshold }),
              ...(scaleMin === undefined ? {} : { scaleMin }),
              ...(scaleMax === undefined ? {} : { scaleMax }),
              ...(ctx.config.has('rubric') ? { hasRubric: true } : {}),
              ...(ctx.config.has('detailSchema') ? { hasDetailSchema: true } : {}),
              ...(chainOfThought === undefined ? {} : { chainOfThought }),
              ...(criteriaPreview ? { criteriaPreview: criteriaPreview.length > 240 ? `${criteriaPreview.slice(0, 237)}...` : criteriaPreview } : {}),
            },
            ...(Object.keys(configuration).length > 0 ? { configuration } : {}),
            ...(settings ? { settings } : {}),
          },
        }),
      ],
      sourceRefs: ['score', 'evaluate', 'run', 'judge']
        .map((property) => ctx.sourceRef.callbackProperty({ property, role: 'validator', definitionId: id }))
        .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref)),
    })
  },
}

/** Keeps JSON-like object metadata while rejecting arrays and primitives that cannot describe config maps. */
function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : undefined
}

/**
 * Normalizes optional scorer configuration into a compact metadata object.
 *
 * Empty fields are omitted so equivalent authored configs produce stable catalog metadata without
 * meaningless `undefined` keys.
 */
function scorerConfiguration(input: {
  model?: string
  threshold?: number
  temperature?: number
  samples?: number
  scaleMin?: number
  scaleMax?: number
  hasRubric: boolean
  hasDetailSchema: boolean
  chainOfThought?: boolean
  settings?: Record<string, unknown>
}): Record<string, unknown> {
  const configuration: Record<string, unknown> = {}
  if (input.model) configuration.model = input.model
  if (input.threshold !== undefined) configuration.threshold = input.threshold
  if (input.temperature !== undefined) configuration.temperature = input.temperature
  if (input.samples !== undefined) configuration.samples = input.samples
  if (input.scaleMin !== undefined || input.scaleMax !== undefined) {
    configuration.scale = {
      ...(input.scaleMin !== undefined ? { min: input.scaleMin } : {}),
      ...(input.scaleMax !== undefined ? { max: input.scaleMax } : {}),
    }
  }
  if (input.hasRubric) configuration.rubric = true
  if (input.hasDetailSchema) configuration.detailSchema = true
  if (input.chainOfThought !== undefined) configuration.chainOfThought = input.chainOfThought
  if (input.settings) configuration.settings = input.settings
  return configuration
}
