import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import type { ProjectDefinition, ProjectDefinitionKind } from '@crux/core/project-index'
import { collectImportBindings, type ImportBinding } from './ast/imports'
import { createSourceFile } from './ast/parse'
import { propertyName } from './ast/literals'

export async function backfillDefinitionPaths(
  root: string,
  definitions: ProjectDefinition[],
  files: readonly string[],
): Promise<ProjectDefinition[]> {
  const byLocalExport = new Map<string, ProjectDefinition>()
  for (const definitionItem of definitions) {
    const exportName =
      typeof definitionItem.metadata?.exportName === 'string' ? definitionItem.metadata.exportName : undefined
    const file = definitionItem.source?.file
    if (!exportName || !file) continue
    byLocalExport.set(`${file}:${exportName}`, definitionItem)
  }

  const pathById = new Map<string, string[]>()
  for (const file of files) {
    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const sourceFile = createSourceFile(file, source)
    const importBindings = collectImportBindings(sourceFile, root, file)
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callName = expressionName(node.expression)
        const firstArg = node.arguments[0]
        if (
          (callName === 'createPrompts' || callName === 'createContexts') &&
          firstArg &&
          ts.isObjectLiteralExpression(firstArg)
        ) {
          const kind: ProjectDefinitionKind = callName === 'createPrompts' ? 'prompt' : 'context'
          collectTreePathBackfills(firstArg, [], kind, file, importBindings, byLocalExport, pathById)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  if (pathById.size === 0) return definitions
  return definitions.map((definitionItem) => {
    if (definitionItem.path && definitionItem.path.length > 0) return definitionItem
    const path = pathById.get(definitionItem.id)
    return path ? { ...definitionItem, path } : definitionItem
  })
}

function collectTreePathBackfills(
  object: ts.ObjectLiteralExpression,
  path: string[],
  kind: ProjectDefinitionKind,
  file: string,
  importBindings: Map<string, ImportBinding>,
  byLocalExport: Map<string, ProjectDefinition>,
  pathById: Map<string, string[]>,
): void {
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) continue
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
    const key = propertyName(property.name)
    if (!key) continue
    const nextPath = [...path, key]
    const initializer = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
    if (ts.isObjectLiteralExpression(initializer)) {
      collectTreePathBackfills(initializer, nextPath, kind, file, importBindings, byLocalExport, pathById)
      continue
    }
    if (!ts.isIdentifier(initializer)) continue
    const definitionItem = resolveDefinitionForAuthoredPath(file, initializer.text, kind, importBindings, byLocalExport)
    if (!definitionItem || pathById.has(definitionItem.id)) continue
    pathById.set(definitionItem.id, nextPath)
  }
}

function resolveDefinitionForAuthoredPath(
  file: string,
  identifier: string,
  kind: ProjectDefinitionKind,
  importBindings: Map<string, ImportBinding>,
  byLocalExport: Map<string, ProjectDefinition>,
): ProjectDefinition | undefined {
  const local = byLocalExport.get(`${file}:${identifier}`)
  if (local?.kind === kind) return local
  const binding = importBindings.get(identifier)
  if (!binding) return undefined
  const imported = byLocalExport.get(`${binding.file}:${binding.importedName}`)
  return imported?.kind === kind ? imported : undefined
}

function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}
