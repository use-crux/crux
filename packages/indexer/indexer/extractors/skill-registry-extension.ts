/**
 * Source discovery for Crux skill registries.
 *
 * Registries are authored as normal TypeScript values. The indexer records the
 * registry value and its source provenance, but it never fetches registry
 * contents or installs runtime registry state during discovery.
 *
 * @module
 */

import ts from 'typescript'
import { propertyName } from '../ast/literals'
import { facts, none, type ExtractContext, type IndexExtractor } from '../extensions'
import { internalStaticCallContext } from '../extensions/internal-native'

/** Extracts `registry({ name, baseUrl })` definitions from source. */
export const registryIndexExtractor: IndexExtractor = {
  name: 'skill-registry',
  patterns: [{ kind: 'call', name: 'registry' }],
  extract: (ctx) => {
    if (!ctx.config) return none()

    const registryName = ctx.config.string('name')
    if (!registryName) return none()

    const id = `registry:${ctx.source.safeId(registryName)}`
    const baseUrl = ctx.config.string('baseUrl')
    const hasAuth = ctx.config.has('auth')

    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'registry',
          name: registryName,
          metadata: {
            exportName: ctx.source.variableName,
            ...(baseUrl ? { baseUrl } : {}),
            hasAuth,
            facts: {
              kind: 'registry',
              registryName,
              ...(baseUrl ? { baseUrl } : {}),
              hasAuth,
            },
          },
        }),
      ],
      sourceRefs: [
        ctx.sourceRef.property({ property: 'name', role: 'config', definitionId: id }),
        ctx.sourceRef.property({ property: 'baseUrl', role: 'config', definitionId: id }),
        ctx.sourceRef.callbackProperty({ property: 'auth', role: 'callback', definitionId: id }),
      ].filter(isDefined),
    })
  },
}

/** Extracts `skill.fromRegistry(registryValue, path)` definitions from source. */
export const registrySkillIndexExtractor: IndexExtractor = {
  name: 'registry-skill',
  patterns: [{ kind: 'call', name: 'fromRegistry' }],
  extract: (ctx) => {
    const registryVariable = ctx.args.identifier(0)
    const registryPath = ctx.args.string(1)
    if (!registryVariable || !registryPath) return none()

    const bundled = bundledRegistryForVariable(registryVariable)
    const registryName = bundled?.name ?? registryNameForVariable(ctx, registryVariable) ?? registryVariable
    const identifier = `${registryName}:${registryPath}`
    const id = `skill:${ctx.source.safeId(identifier)}`

    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'skill',
          name: identifier,
          metadata: {
            exportName: ctx.source.variableName,
            loader: 'registry',
            identifier,
            registryName,
            registryPath,
            registryVariable,
            facts: {
              kind: 'skill',
              loader: 'registry',
              identifier,
              registryName,
              registryPath,
              registryVariable,
            },
          },
        }),
        ...(bundled
          ? [
              ctx.define.definition({
                variableName: registryVariable,
                id: bundled.id,
                kind: 'registry',
                name: bundled.name,
                metadata: {
                  exportName: registryVariable,
                  bundled: true,
                  facts: {
                    kind: 'registry',
                    registryName: bundled.name,
                    bundled: true,
                  },
                },
              }),
            ]
          : []),
      ],
      references: [
        bundled
          ? ctx.ref.id('skill.uses_registry', bundled.id)
          : ctx.ref.variable('skill.uses_registry', registryVariable),
      ],
    })
  },
}

function bundledRegistryForVariable(registryVariable: string): { readonly id: string; readonly name: string } | undefined {
  return registryVariable === 'skillsSh' ? { id: 'registry:skills.sh', name: 'skills.sh' } : undefined
}

function registryNameForVariable(ctx: ExtractContext, registryVariable: string): string | undefined {
  const staticCtx = internalStaticCallContext(ctx)
  const initializer = staticCtx?.localInitializers.get(registryVariable)
  if (!initializer || !ts.isCallExpression(initializer) || expressionName(initializer.expression) !== 'registry') {
    return undefined
  }
  const [config] = initializer.arguments
  if (!config || !ts.isObjectLiteralExpression(config)) return undefined
  return stringProperty(config, 'name')
}

function stringProperty(object: ts.ObjectLiteralExpression, property: string): string | undefined {
  const assignment = object.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === property,
  )
  return assignment && ts.isStringLiteralLike(assignment.initializer) ? assignment.initializer.text : undefined
}

function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

/** Removes missing source refs for optional registry fields. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
