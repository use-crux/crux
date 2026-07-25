import ts from "typescript";
import type {
  SemanticValueExportRoute,
  SemanticValueExportRouteSet,
} from "../../model/export-provenance";
import {
  canonicalSymbol,
  moduleExportName,
  nearestImportDeclaration,
} from "./export-symbols";

export type TypeScriptCanonicalPackageRoot = (
  moduleSpecifier: ts.StringLiteralLike,
  module: ts.Symbol,
  expectedModuleName: string,
) => boolean;

export interface TypeScriptRootExportEdge {
  readonly kind: "module";
  readonly module: ts.Symbol;
  readonly exportName: string;
  readonly canonicalPackageRoot: boolean;
  readonly moduleSpecifier: ts.StringLiteralLike;
}

export interface TypeScriptExportRoutes {
  /** Resolve the import edge owning an authored tag declaration. */
  readonly root: (
    declaration: ts.Declaration,
    exportName: string,
    expectedModuleName: string,
  ) => TypeScriptRootExportEdge | undefined;
  /** Return authored value-export routes for one module export. */
  readonly routes: (
    module: ts.Symbol,
    exportName: string,
  ) => SemanticValueExportRouteSet<ts.Symbol, ts.Symbol>;
}

/** Creates authored TypeScript value-export traversal for one identity proof. */
export function createTypeScriptExportRoutes(
  checker: ts.TypeChecker,
  canonicalPackageRoot: TypeScriptCanonicalPackageRoot,
): TypeScriptExportRoutes {
  return { root: moduleEdge, routes };

  function routes(module: ts.Symbol, exportName: string) {
    const source = moduleSourceFile(module);
    if (!source) return { routes: [], invalid: true } as const;
    const explicit = explicitRoutes(source, exportName);
    if (explicit.invalid || explicit.routes.some((route) => !route.typeOnly)) {
      return explicit;
    }
    return starRoutes(source, exportName);
  }

  function explicitRoutes(source: ts.SourceFile, exportName: string) {
    const routes: SemanticValueExportRoute<ts.Symbol, ts.Symbol>[] = [];
    for (const statement of source.statements) {
      const direct = directDeclarationRoute(statement, exportName);
      if (direct) routes.push(direct);
      if (
        !ts.isExportDeclaration(statement) ||
        !statement.exportClause ||
        !ts.isNamedExports(statement.exportClause)
      ) {
        continue;
      }
      for (const specifier of statement.exportClause.elements) {
        if (moduleExportName(specifier.name) !== exportName) continue;
        if (statement.isTypeOnly || specifier.isTypeOnly) continue;
        if (statement.moduleSpecifier) {
          if (!ts.isStringLiteralLike(statement.moduleSpecifier)) {
            return { routes: [], invalid: true } as const;
          }
          const importedName =
            moduleExportName(specifier.propertyName) ??
            moduleExportName(specifier.name);
          if (!importedName) return { routes: [], invalid: true } as const;
          const edge = resolvedModuleEdge(
            statement.moduleSpecifier,
            importedName,
          );
          if (!edge) return { routes: [], invalid: true } as const;
          routes.push(edge);
          continue;
        }
        const target = checker.getExportSpecifierLocalTargetSymbol(specifier);
        const local = target && localSymbolRoute(target, false);
        if (!local) return { routes: [], invalid: true } as const;
        routes.push(local);
      }
    }
    return { routes } as const;
  }

  function starRoutes(source: ts.SourceFile, exportName: string) {
    const routes: SemanticValueExportRoute<ts.Symbol, ts.Symbol>[] = [];
    for (const statement of source.statements) {
      if (
        !ts.isExportDeclaration(statement) ||
        statement.exportClause ||
        !statement.moduleSpecifier ||
        !ts.isStringLiteralLike(statement.moduleSpecifier)
      ) {
        continue;
      }
      if (statement.isTypeOnly) continue;
      const edge = resolvedModuleEdge(statement.moduleSpecifier, exportName);
      if (!edge) return { routes: [], invalid: true } as const;
      if (
        !checker
          .getExportsOfModule(edge.module)
          .some((symbol) => symbol.getName() === exportName)
      ) {
        continue;
      }
      routes.push(edge);
    }
    return { routes } as const;
  }

  function directDeclarationRoute(statement: ts.Statement, exportName: string) {
    // `export default <identifier>` parses as an ExportAssignment whose
    // `export` token is syntax, not a modifier, so it must be routed before
    // the ordinary export-modifier gate.
    if (ts.isExportAssignment(statement)) {
      if (
        exportName !== "default" ||
        statement.isExportEquals ||
        !ts.isIdentifier(statement.expression)
      ) {
        return undefined;
      }
      const symbol = checker.getSymbolAtLocation(statement.expression);
      return symbol && localSymbolRoute(symbol, false);
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return undefined;
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(
        (candidate) =>
          ts.isIdentifier(candidate.name) && candidate.name.text === exportName,
      );
      return declaration && ts.isIdentifier(declaration.name)
        ? terminalRouteForName(declaration.name)
        : undefined;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name?.text === exportName
    ) {
      return terminalRouteForName(statement.name);
    }
    return undefined;
  }

  function localSymbolRoute(symbol: ts.Symbol, typeOnly: boolean) {
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isImportSpecifier(declaration)) {
        const edge = moduleEdge(
          declaration,
          moduleExportName(declaration.propertyName) ?? declaration.name.text,
          "",
        );
        return edge ? { ...edge, typeOnly } : undefined;
      }
      if (ts.isImportClause(declaration) && declaration.name) {
        const edge = moduleEdge(declaration, "default", "");
        return edge ? { ...edge, typeOnly } : undefined;
      }
    }
    const terminal = canonicalSymbol(symbol, checker);
    return terminal
      ? ({ kind: "terminal", terminal, typeOnly } as const)
      : undefined;
  }

  function terminalRouteForName(name: ts.Identifier) {
    const terminal = canonicalSymbol(
      checker.getSymbolAtLocation(name),
      checker,
    );
    return terminal ? ({ kind: "terminal", terminal } as const) : undefined;
  }

  function resolvedModuleEdge(
    moduleSpecifier: ts.StringLiteralLike,
    exportName: string,
  ) {
    const module = checker.getSymbolAtLocation(moduleSpecifier);
    return module
      ? ({
          kind: "module",
          module,
          exportName,
          canonicalPackageRoot: canonicalPackageRoot(
            moduleSpecifier,
            module,
            "",
          ),
        } as const)
      : undefined;
  }

  function moduleEdge(
    declaration: ts.Declaration,
    exportName: string,
    expectedModuleName: string,
  ): TypeScriptRootExportEdge | undefined {
    const owner = nearestImportDeclaration(declaration);
    if (!owner || !ts.isStringLiteralLike(owner.moduleSpecifier)) {
      return undefined;
    }
    const module = checker.getSymbolAtLocation(owner.moduleSpecifier);
    return module
      ? {
          kind: "module",
          module,
          exportName,
          canonicalPackageRoot: canonicalPackageRoot(
            owner.moduleSpecifier,
            module,
            expectedModuleName,
          ),
          moduleSpecifier: owner.moduleSpecifier,
        }
      : undefined;
  }
}

function moduleSourceFile(module: ts.Symbol): ts.SourceFile | undefined {
  const sources = (module.declarations ?? []).filter(ts.isSourceFile);
  return sources.length === 1 ? sources[0] : undefined;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === kind),
  );
}
