import ts from 'typescript'
import type { ProjectDefinition } from '@crux/core/catalog'
import { collectTopLevelInitializers, scopedInitializersForNode } from './ast/initializers'
import { collectImportBindings } from './ast/imports'
import { readSourceFile } from './ast/parse'
import { relationsFromStaticDefinitions } from './relations'
import type { StaticFileParser, StaticFoundDefinition, StaticParseResult } from './types'

const staticPrimitiveCallNames = new Set([
  'agent',
  'blackboard',
  'convexAgent',
  'constraint',
  'consensus',
  'flow',
  'cruxFlow',
  'guardrail',
  'llmJudge',
  'memory',
  'parallel',
  'pipeline',
  'retrievalPipeline',
  'retriever',
  'scorer',
  'swarm',
  'workspace',
])

export async function parseStaticDefinitions(root: string, file: string, parser: StaticFileParser): Promise<StaticParseResult> {
  const sourceFile = await readSourceFile(file)
  const found: StaticFoundDefinition[] = []
  const localInitializers = new Map<string, ts.Expression>()
  const importBindings = collectImportBindings(sourceFile, root, file)

  collectTopLevelInitializers(sourceFile, localInitializers)

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && parser.hasExportModifier(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        const parsed = parser.staticDefinitionFromInitializer(root, file, sourceFile, declaration.name.text, declaration.initializer, localInitializers)
        if (parsed) found.push(parsed)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  addCallSiteDefinitions(root, file, sourceFile, localInitializers, found, parser)
  const pathDefinitions = await parser.staticTreePathDefinitions(root, file, sourceFile, localInitializers, found, importBindings)

  const importedDefinitions = await importedDefinitionsForRelations(root, importBindings, parser)
  const relations = relationsFromStaticDefinitions(found, importedDefinitions)
  const dependencies = [...new Set([...importBindings.values()].map((binding) => binding.file))].sort()

  return { definitions: [...found.flatMap((item) => [item.definition, ...(item.extraDefinitions ?? [])]), ...pathDefinitions], relations, dependencies }
}

async function importedDefinitionsForRelations(
  root: string,
  importBindings: Map<string, { importedName: string; file: string }>,
  parser: StaticFileParser,
): Promise<Map<string, ProjectDefinition>> {
  const definitions = new Map<string, ProjectDefinition>()
  const parsedFiles = new Map<string, { sourceFile: ts.SourceFile; localInitializers: Map<string, ts.Expression> }>()

  for (const [localName, binding] of importBindings) {
    if (binding.importedName === 'default') continue
    let parsed = parsedFiles.get(binding.file)
    if (!parsed) {
      try {
        const sourceFile = await readSourceFile(binding.file)
        const localInitializers = new Map<string, ts.Expression>()
        collectTopLevelInitializers(sourceFile, localInitializers)
        parsed = { sourceFile, localInitializers }
        parsedFiles.set(binding.file, parsed)
      } catch {
        continue
      }
    }
    const initializer = parsed.localInitializers.get(binding.importedName)
    if (!initializer) continue
    const found = parser.staticDefinitionFromInitializer(
      root,
      binding.file,
      parsed.sourceFile,
      binding.importedName,
      initializer,
      parsed.localInitializers,
    )
    if (found) definitions.set(localName, found.definition)
  }

  return definitions
}

function addCallSiteDefinitions(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  localInitializers: Map<string, ts.Expression>,
  found: StaticFoundDefinition[],
  parser: StaticFileParser,
): void {
  const seen = new Set(found.map((item) => item.definition.id))
  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && !parser.hasExportModifier(node)) {
      const scopedInitializers = scopedInitializersForNode(node, localInitializers)
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        const parsed = parser.staticDefinitionFromInitializer(root, file, sourceFile, declaration.name.text, declaration.initializer, scopedInitializers)
        if (parsed && !seen.has(parsed.definition.id)) {
          seen.add(parsed.definition.id)
          found.push(parsed)
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const callName = parser.expressionName(node.expression)
      if (callName && staticPrimitiveCallNames.has(callName)) {
        const scopedInitializers = scopedInitializersForNode(node, localInitializers)
        const parsed = parser.staticDefinitionFromCall(root, file, sourceFile, callName, node, scopedInitializers)
        if (parsed && !seen.has(parsed.definition.id)) {
          seen.add(parsed.definition.id)
          found.push(parsed)
        }
      }
    }
    if (ts.isNewExpression(node) && parser.expressionName(node.expression) === 'Agent') {
      const scopedInitializers = scopedInitializersForNode(node, localInitializers)
      const sourceLine = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1
      const parsed = parser.staticDefinitionFromInitializer(root, file, sourceFile, `agent-${sourceLine}`, node, scopedInitializers)
      if (parsed && !seen.has(parsed.definition.id)) {
        seen.add(parsed.definition.id)
        found.push(parsed)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}
