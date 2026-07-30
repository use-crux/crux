import {
  isClassDeclaration,
  isEnumDeclaration,
  isExportAssignment,
  isExportDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isImportClause,
  isImportSpecifier,
  isNamedExports,
  isSourceFile,
  isStringLiteral,
  isVariableDeclaration,
  type Node,
  type SourceFile,
} from "@typescript/native-preview/unstable/ast";
import type {
  Project,
  Symbol as TsgoSymbol,
} from "@typescript/native-preview/unstable/sync";
import {
  semanticValueExportTerminal,
  type SemanticValueExportRoute,
} from "../../model/export-provenance";
import {
  nativeModuleExportNameText,
  nativeTopLevelDeclarations,
  nearestNativeImportDeclaration,
} from "./native-source-declarations";
import { nativeNodeList } from "./source";
import { tsgoTagSite } from "./tag-site";

export type TsgoTerminalSymbol = TsgoSymbol | "type-only" | undefined;

export interface TsgoExportProvenanceInput {
  readonly project: Project;
  readonly terminalSymbol: (
    symbol: TsgoSymbol | undefined,
  ) => TsgoTerminalSymbol;
  readonly canonicalPackageEdge: (
    moduleSpecifier: Node,
    module: TsgoSymbol,
    expectedModuleName: string,
  ) => boolean;
}

export interface TsgoCanonicalExportProof {
  readonly site: TsgoSymbol;
  readonly terminal: TsgoSymbol;
}

/** Proves one native tag-site binding through authored value-export routes. */
export function tsgoCanonicalExportProof(
  node: Node,
  moduleName: string,
  input: TsgoExportProvenanceInput,
  namespaceExportName?: string,
): TsgoCanonicalExportProof | undefined {
  const site = tsgoTagSite(
    node,
    input.project,
    input.terminalSymbol,
    namespaceExportName,
  );
  if (!site) return undefined;
  const root = moduleEdge(site.declaration, site.exportName, moduleName, input);
  if (!root) return undefined;
  const terminal = semanticValueExportTerminal<TsgoSymbol, TsgoSymbol>({
    module: root.module,
    exportName: root.exportName,
    canonicalPackageRoot: root.canonicalPackageRoot,
    view: {
      moduleKey: (symbol) => String(symbol.id),
      terminalKey: (symbol) => String(symbol.id),
      routes: (module, exportName) =>
        routesForModule(module, exportName, input),
    },
  });
  return terminal ? { site: site.terminal, terminal } : undefined;
}

function routesForModule(
  module: TsgoSymbol,
  exportName: string,
  input: TsgoExportProvenanceInput,
) {
  const source = moduleSourceFile(module, input.project);
  if (!source) return { routes: [], invalid: true } as const;
  const explicit = explicitRoutes(source, exportName, input);
  if (explicit.invalid || explicit.routes.some((route) => !route.typeOnly)) {
    return explicit;
  }
  return starRoutes(source, exportName, input);
}

function explicitRoutes(
  source: SourceFile,
  exportName: string,
  input: TsgoExportProvenanceInput,
) {
  const routes: SemanticValueExportRoute<TsgoSymbol, TsgoSymbol>[] = [];
  for (const declaration of nativeTopLevelDeclarations(
    source,
    exportName,
    true,
  )) {
    const terminal = terminalForDeclaration(declaration, input);
    if (terminal) routes.push({ kind: "terminal", terminal });
  }

  for (const statement of nativeNodeList(source.statements)) {
    if (
      !isExportDeclaration(statement) ||
      !statement.exportClause ||
      !isNamedExports(statement.exportClause)
    ) {
      if (
        exportName === "default" &&
        isExportAssignment(statement) &&
        !statement.isExportEquals &&
        isIdentifier(statement.expression)
      ) {
        const local = localSymbolRoute(
          input.project.checker.getSymbolAtLocation(statement.expression),
          false,
          input,
        );
        if (local) routes.push(local);
      }
      continue;
    }
    for (const specifier of nativeNodeList(statement.exportClause.elements)) {
      if (nativeModuleExportNameText(specifier.name) !== exportName) continue;
      const typeOnly = statement.isTypeOnly || specifier.isTypeOnly;
      if (typeOnly) continue;
      if (statement.moduleSpecifier) {
        const importedName =
          nativeModuleExportNameText(specifier.propertyName) ??
          nativeModuleExportNameText(specifier.name);
        if (!importedName) return { routes: [], invalid: true } as const;
        const edge = resolvedModuleEdge(
          statement.moduleSpecifier,
          importedName,
          "",
          input,
        );
        if (!edge) return { routes: [], invalid: true } as const;
        routes.push(edge);
        continue;
      }
      const target =
        input.project.checker.getExportSpecifierLocalTargetSymbol(specifier);
      const local = target && localSymbolRoute(target, false, input);
      if (!local) return { routes: [], invalid: true } as const;
      routes.push(local);
    }
  }
  return { routes } as const;
}

function starRoutes(
  source: SourceFile,
  exportName: string,
  input: TsgoExportProvenanceInput,
) {
  const routes: SemanticValueExportRoute<TsgoSymbol, TsgoSymbol>[] = [];
  for (const statement of nativeNodeList(source.statements)) {
    if (
      !isExportDeclaration(statement) ||
      statement.exportClause ||
      !statement.moduleSpecifier
    ) {
      continue;
    }
    if (statement.isTypeOnly) continue;
    const edge = resolvedModuleEdge(
      statement.moduleSpecifier,
      exportName,
      "",
      input,
    );
    if (!edge) return { routes: [], invalid: true } as const;
    if (
      !input.project.checker
        .getExportsOfModule(edge.module)
        .some((symbol) => symbol.name === exportName)
    ) {
      continue;
    }
    routes.push(edge);
  }
  return { routes } as const;
}

function localSymbolRoute(
  symbol: TsgoSymbol | undefined,
  typeOnly: boolean,
  input: TsgoExportProvenanceInput,
): SemanticValueExportRoute<TsgoSymbol, TsgoSymbol> | undefined {
  if (!symbol) return undefined;
  for (const handle of symbol.declarations) {
    const declaration = handle.resolve(input.project);
    if (declaration && isImportSpecifier(declaration)) {
      const edge = moduleEdge(
        declaration,
        nativeModuleExportNameText(declaration.propertyName) ??
          declaration.name.text,
        "",
        input,
      );
      return edge ? { ...edge, typeOnly } : undefined;
    }
    if (declaration && isImportClause(declaration) && declaration.name) {
      const edge = moduleEdge(declaration, "default", "", input);
      return edge ? { ...edge, typeOnly } : undefined;
    }
  }
  const terminal = input.terminalSymbol(symbol);
  return terminal && terminal !== "type-only"
    ? { kind: "terminal", terminal, typeOnly }
    : undefined;
}

function terminalForDeclaration(
  declaration: Node,
  input: TsgoExportProvenanceInput,
): TsgoSymbol | undefined {
  const name =
    isVariableDeclaration(declaration) && isIdentifier(declaration.name)
      ? declaration.name
      : (isFunctionDeclaration(declaration) ||
            isClassDeclaration(declaration) ||
            isEnumDeclaration(declaration)) &&
          declaration.name
        ? declaration.name
        : undefined;
  if (!name) return undefined;
  const terminal = input.terminalSymbol(
    input.project.checker.getSymbolAtLocation(name),
  );
  return terminal && terminal !== "type-only" ? terminal : undefined;
}

function moduleEdge(
  declaration: Node,
  exportName: string,
  expectedModuleName: string,
  input: TsgoExportProvenanceInput,
) {
  const owner = nearestNativeImportDeclaration(declaration);
  return owner
    ? resolvedModuleEdge(
        owner.moduleSpecifier,
        exportName,
        expectedModuleName,
        input,
      )
    : undefined;
}

function resolvedModuleEdge(
  moduleSpecifier: Node,
  exportName: string,
  expectedModuleName: string,
  input: TsgoExportProvenanceInput,
) {
  if (!isStringLiteral(moduleSpecifier)) return undefined;
  const module = input.project.checker.getSymbolAtLocation(moduleSpecifier);
  return module
    ? ({
        kind: "module",
        module,
        exportName,
        canonicalPackageRoot: input.canonicalPackageEdge(
          moduleSpecifier,
          module,
          expectedModuleName,
        ),
      } as const)
    : undefined;
}

function moduleSourceFile(
  module: TsgoSymbol,
  project: Project,
): SourceFile | undefined {
  const sources = module.declarations
    .map((handle) => handle.resolve(project))
    .filter((node): node is SourceFile => Boolean(node && isSourceFile(node)));
  return sources.length === 1 ? sources[0] : undefined;
}
