import ts from 'typescript'
import { hasProperty, propertyName, stringProperty } from '../ast/literals'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'

export const workspaceExtractor: PrimitiveExtractor = {
  name: 'workspace',
  capabilities: ['definition', 'source', 'runtime-join', 'partial'],
  callNames: ['workspace'],
  extract: (ctx) => {
    if (ctx.callName !== 'workspace') return undefined
    const explicitId = ctx.objectArg ? stringProperty(ctx.objectArg, 'id') : undefined
    const id = `workspace:${ctx.safeId(explicitId ?? ctx.localName)}`
    const toolRefs = ctx.objectArg ? workspaceToolRefs(ctx.objectArg) : []
    const mounts = ctx.objectArg ? workspaceMountsMetadata(ctx.objectArg) : undefined
    return foundDefinition(
      ctx.variableName,
      ctx.define(id, 'workspace', explicitId ?? ctx.variableName, ctx.objectArg, {
        exportName: ctx.variableName,
        namespace: ctx.objectArg ? stringProperty(ctx.objectArg, 'namespace') : undefined,
        mounts,
        hasTools: ctx.objectArg ? hasProperty(ctx.objectArg, 'tools') : undefined,
        toolRefs: toolRefs.length > 0 ? toolRefs : undefined,
        hasBlobStorage: ctx.objectArg ? hasProperty(ctx.objectArg, 'blobs') || hasProperty(ctx.objectArg, 'storage') : undefined,
        intelligence: workspaceIntelligence(mounts, toolRefs),
      }),
      [
        ...toolRefs.map((toVariable) => ({ type: 'workspace.exposes_tool', fromId: id, toVariable })),
        ...(mounts ?? []).flatMap((mount) =>
          typeof mount.path === 'string'
            ? [{
                type: 'workspace.mounts_path',
                fromId: id,
                toId: `workspace.path:${ctx.safeId(explicitId ?? ctx.localName)}:${ctx.safeId(mount.path)}`,
              }]
            : [],
        ),
      ],
    )
  },
}

function workspaceMountsMetadata(object: ts.ObjectLiteralExpression): Array<Record<string, unknown>> | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === 'mounts')
  if (!property || !ts.isArrayLiteralExpression(property.initializer)) return undefined
  const mounts = property.initializer.elements
    .filter((element): element is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(element))
    .map((mount) => ({
      path: stringProperty(mount, 'path'),
      access: stringProperty(mount, 'access'),
      description: stringProperty(mount, 'description'),
    }))
    .filter((mount) => mount.path || mount.access || mount.description)
  return mounts.length > 0 ? mounts : undefined
}

function workspaceToolRefs(object: ts.ObjectLiteralExpression): string[] {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === 'tools')
  if (!property || !ts.isObjectLiteralExpression(property.initializer)) return []
  return property.initializer.properties
    .map((item) => {
      if (ts.isShorthandPropertyAssignment(item)) return item.name.text
      if (ts.isPropertyAssignment(item) && ts.isIdentifier(item.initializer)) return item.initializer.text
      return undefined
    })
    .filter((value): value is string => typeof value === 'string')
}

function workspaceIntelligence(mounts: Array<Record<string, unknown>> | undefined, toolRefs: readonly string[]): Record<string, unknown> | undefined {
  if ((!mounts || mounts.length === 0) && toolRefs.length === 0) return undefined
  return {
    confidence: 'static',
    data: {
      ...(mounts && mounts.length > 0
        ? {
            artifacts: mounts
              .filter((mount): mount is { path: string; access?: string } => typeof mount.path === 'string')
              .map((mount) => ({ name: mount.path, kind: mount.access ?? 'mount' })),
          }
        : {}),
    },
    ...(toolRefs.length > 0 ? { tools: [...toolRefs] } : {}),
  }
}
