import ts from 'typescript'
import { hasProperty, identifierProperty, literalValue, numberProperty, propertyName, stringProperty } from '../ast/literals'
import { callbackSourceRefForProperty } from '../ast/source-refs'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'

export const scorerExtractor: PrimitiveExtractor = {
  name: 'scorer',
  capabilities: ['definition', 'source', 'runtime-join', 'partial'],
  callNames: ['llmJudge'],
  extract: (ctx) => {
    if (ctx.callName !== 'llmJudge' || !ctx.objectArg) return undefined
    const explicitId = stringProperty(ctx.objectArg, 'id')
    const id = `scorer:${ctx.safeId(explicitId ?? ctx.localName)}`
    const model = stringProperty(ctx.objectArg, 'model') ?? identifierProperty(ctx.objectArg, 'model')
    const threshold = numberProperty(ctx.objectArg, 'threshold')
    const temperature = numberProperty(ctx.objectArg, 'temperature')
    const samples = numberProperty(ctx.objectArg, 'samples') ?? numberProperty(ctx.objectArg, 'sampleCount')
    const scale = objectProperty(ctx.objectArg, 'scale', ctx.localInitializers)
    const scaleMin = scale ? numberProperty(scale, 'min') : undefined
    const scaleMax = scale ? numberProperty(scale, 'max') : undefined
    const chainOfThought = booleanProperty(ctx.objectArg, 'chainOfThought')
    const criteriaPreview = stringProperty(ctx.objectArg, 'criteria')
    const settings = literalObjectProperty(ctx.objectArg, 'settings', ctx.localInitializers)
    const configuration = scorerConfiguration({
      model,
      threshold,
      temperature,
      samples,
      scaleMin,
      scaleMax,
      hasRubric: hasProperty(ctx.objectArg, 'rubric'),
      hasDetailSchema: hasProperty(ctx.objectArg, 'detailSchema'),
      chainOfThought,
      settings,
    })
    const sourceRefs = ['score', 'evaluate', 'run', 'judge']
      .map((property) => callbackSourceRefForProperty({ ...ctx, object: ctx.objectArg!, property, role: 'validator', definitionId: id }))
      .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
    return foundDefinition(
      ctx.variableName,
      {
        ...ctx.define(id, 'scorer', explicitId ?? ctx.variableName, ctx.objectArg, {
          exportName: ctx.variableName,
          facts: {
            kind: 'scorer',
            scorerId: explicitId ?? ctx.variableName,
            ...(model ? { model } : {}),
            ...(threshold === undefined ? {} : { threshold }),
            ...(scaleMin === undefined ? {} : { scaleMin }),
            ...(scaleMax === undefined ? {} : { scaleMax }),
            ...(hasProperty(ctx.objectArg, 'rubric') ? { hasRubric: true } : {}),
            ...(hasProperty(ctx.objectArg, 'detailSchema') ? { hasDetailSchema: true } : {}),
            ...(chainOfThought === undefined ? {} : { chainOfThought }),
            ...(criteriaPreview ? { criteriaPreview: criteriaPreview.length > 240 ? `${criteriaPreview.slice(0, 237)}...` : criteriaPreview } : {}),
          },
          ...(Object.keys(configuration).length > 0 ? { configuration } : {}),
          ...(settings ? { settings } : {}),
        }),
        ...(sourceRefs.length > 0 ? { sourceRefs } : {}),
      },
    )
  },
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.ObjectLiteralExpression | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  if (!property) return undefined
  if (ts.isObjectLiteralExpression(property.initializer)) return property.initializer
  if (!ts.isIdentifier(property.initializer)) return undefined
  const resolved = localInitializers.get(property.initializer.text)
  return resolved && ts.isObjectLiteralExpression(resolved) ? resolved : undefined
}

function booleanProperty(object: ts.ObjectLiteralExpression, name: string): boolean | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  const value = property ? literalValue(property.initializer) : undefined
  return typeof value === 'boolean' ? value : undefined
}

function literalObjectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): Record<string, unknown> | undefined {
  const value = objectProperty(object, name, localInitializers)
  if (!value) return undefined
  const record: Record<string, unknown> = {}
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const key = propertyName(property.name)
    if (!key) continue
    const literal = literalValue(property.initializer)
    if (literal !== undefined) record[key] = literal
  }
  return Object.keys(record).length > 0 ? record : undefined
}

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
