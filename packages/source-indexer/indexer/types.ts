import type ts from 'typescript'
import type { ProjectDefinition, ProjectDefinitionKind, ProjectRelation } from '@crux/core/catalog'

export interface StaticParseResult {
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  dependencies: string[]
}

export interface SourceGraph {
  dependenciesByFile: Map<string, string[]>
}

export interface StaticRelationRef {
  type: string
  typeByTargetKind?: Partial<Record<ProjectDefinitionKind, string>>
  fromId?: string
  fromVariable?: string
  toVariable?: string
  toId?: string
}

export interface StaticFoundDefinition {
  variableName: string
  definition: ProjectDefinition
  extraDefinitions?: ProjectDefinition[]
  relationRefs: StaticRelationRef[]
}

export interface StaticFileParser {
  staticDefinitionFromInitializer: (
    root: string,
    file: string,
    sourceFile: ts.SourceFile,
    variableName: string,
    initializer: ts.Expression,
    localInitializers: Map<string, ts.Expression>,
  ) => StaticFoundDefinition | undefined
  staticDefinitionFromCall: (
    root: string,
    file: string,
    sourceFile: ts.SourceFile,
    callName: string,
    call: ts.CallExpression,
    localInitializers: Map<string, ts.Expression>,
  ) => StaticFoundDefinition | undefined
  staticTreePathDefinitions: (
    root: string,
    file: string,
    sourceFile: ts.SourceFile,
    localInitializers: Map<string, ts.Expression>,
    found: StaticFoundDefinition[],
    importBindings: Map<string, ImportBinding>,
  ) => Promise<ProjectDefinition[]>
  expressionName: (expression: ts.Expression) => string | undefined
  hasExportModifier: (node: ts.Node) => boolean
}

export interface ImportBinding {
  importedName: string
  file: string
}
