import ts from "typescript";
import type {
  SemanticCanonicalValueBinding,
  SemanticCompilerSourceFile,
  SemanticCompilerView,
} from "../../compiler-view";
import type { SemanticBackendIdentity } from "../../service/types";
import type { SemanticCacheValidationDependencyCollector } from "../../cache-validation";
import { createTypeScriptSemanticSyntaxView } from "./syntax-view";
import { createTypeScriptCanonicalExportIdentity } from "./canonical-export-identity";
import { semanticProgramModuleResolutionEvidence } from "./program";

export type TypeScriptSemanticCompilerView = SemanticCompilerView<
  ts.Node,
  ts.SourceFile & SemanticCompilerSourceFile,
  ts.Declaration,
  ts.Symbol,
  ts.Type
>;

export interface TypeScriptSemanticCompilerViewInput {
  /** Backend identity attached to this compiler view. */
  readonly identity: SemanticBackendIdentity;
  /** TypeScript program that owns source files and compiler options. */
  readonly program: ts.Program;
  /** Type checker paired with the program. */
  readonly checker: ts.TypeChecker;
  /** Package roots rejected because compiler paths can intercept them. */
  readonly interceptedModuleNames?: ReadonlySet<string>;
  /** Exact package manifests used by canonical package proof. */
  readonly validationDependencies?: SemanticCacheValidationDependencyCollector;
}

/**
 * Creates a Crux semantic compiler view backed by the TypeScript compiler API.
 *
 * The adapter keeps direct `ts.Program` and `ts.TypeChecker` access inside the
 * TypeScript backend. Its methods are batch-shaped so future IPC-backed
 * backends can implement the same contract without one remote call per node.
 */
export function createTypeScriptSemanticCompilerView(
  input: TypeScriptSemanticCompilerViewInput,
): TypeScriptSemanticCompilerView {
  const { checker, identity, program } = input;
  const canonicalExportIdentity = createTypeScriptCanonicalExportIdentity({
    program,
    checker,
    moduleResolution: semanticProgramModuleResolutionEvidence(program),
    interceptedModuleNames: input.interceptedModuleNames ?? new Set(),
    validationDependencies: input.validationDependencies,
  });
  const syntax = createTypeScriptSemanticSyntaxView({
    sourceFiles(files) {
      const selected = new Set(files);
      return program
        .getSourceFiles()
        .filter(
          (
            sourceFile,
          ): sourceFile is ts.SourceFile & SemanticCompilerSourceFile =>
            selected.has(sourceFile.fileName),
        );
    },
  });

  return {
    identity,
    syntax,
    sourceFiles(files) {
      return syntax.sourceFiles(files);
    },
    sourceFile(node) {
      return syntax.sourceFile(node);
    },
    sourceText(node) {
      return syntax.text(node);
    },
    childNodes(node) {
      return syntax.children(node);
    },
    symbolsAt(nodes) {
      return nodes.map((node) => checker.getSymbolAtLocation(node));
    },
    resolvedSymbols(nodes) {
      return nodes.map((node) => {
        const symbol =
          shorthandAssignmentValueSymbol(node, checker) ??
          checker.getSymbolAtLocation(node);
        return symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      });
    },
    shorthandAssignmentValueSymbols(nodes) {
      return nodes.map((node) => shorthandAssignmentValueSymbol(node, checker));
    },
    typesAt(nodes) {
      return nodes.map((node) => checker.getTypeAtLocation(node));
    },
    typeStrings(types, enclosing) {
      return types.map((type) => checker.typeToString(type, enclosing));
    },
    declarationsOf(symbols) {
      return symbols.map((symbol) => symbol.declarations ?? []);
    },
    canonicalExportIdentity(node, moduleName, exportName) {
      return canonicalExportIdentity(node, moduleName, exportName)
        ? { module: moduleName, export: exportName }
        : undefined;
    },
    canonicalValueBindingsAt(node, moduleName, exportName) {
      return canonicalValueBindingsAt(
        node,
        moduleName,
        exportName,
        checker,
        canonicalExportIdentity,
      );
    },
  };
}

function canonicalValueBindingsAt(
  node: ts.Node,
  moduleName: string,
  exportName: string,
  checker: ts.TypeChecker,
  canonical: (node: ts.Node, moduleName: string, exportName: string) => boolean,
): readonly SemanticCanonicalValueBinding[] {
  const result: SemanticCanonicalValueBinding[] = [];
  for (const statement of node.getSourceFile().statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.isTypeOnly
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        const local = specifier.name;
        if (
          !specifier.isTypeOnly &&
          canonical(local, moduleName, exportName) &&
          sameBindingAt(local, node, checker)
        ) {
          result.push({ kind: "identifier", expression: local.text });
        }
      }
    } else if (
      bindings &&
      ts.isNamespaceImport(bindings) &&
      canonical(bindings.name, moduleName, exportName) &&
      sameBindingAt(bindings.name, node, checker)
    ) {
      result.push({
        kind: "namespace-access",
        expression: `${bindings.name.text}.${exportName}`,
      });
    }
  }
  return result;
}

function sameBindingAt(
  binding: ts.Identifier,
  node: ts.Node,
  checker: ts.TypeChecker,
): boolean {
  const declared = checker.getSymbolAtLocation(binding);
  const visible = checker.resolveName(
    binding.text,
    node,
    ts.SymbolFlags.Value,
    true,
  );
  return Boolean(declared && visible && declared === visible);
}

function shorthandAssignmentValueSymbol(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  if (!ts.isIdentifier(node) || !ts.isShorthandPropertyAssignment(node.parent))
    return undefined;
  return checker.getShorthandAssignmentValueSymbol(node.parent);
}
