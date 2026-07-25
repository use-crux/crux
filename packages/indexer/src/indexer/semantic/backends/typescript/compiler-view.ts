import ts from "typescript";
import type {
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
  };
}

function shorthandAssignmentValueSymbol(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  if (!ts.isIdentifier(node) || !ts.isShorthandPropertyAssignment(node.parent))
    return undefined;
  return checker.getShorthandAssignmentValueSymbol(node.parent);
}
