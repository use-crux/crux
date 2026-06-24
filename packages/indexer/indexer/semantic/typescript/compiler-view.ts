import ts from 'typescript'
import type {
  SemanticCompilerSourceFile,
  SemanticCompilerView,
} from '../compiler-view'
import type { SemanticBackendIdentity } from '../service/types'

export type TypeScriptSemanticCompilerView = SemanticCompilerView<
  ts.Node,
  ts.SourceFile & SemanticCompilerSourceFile,
  ts.Declaration,
  ts.Symbol,
  ts.Type
>

export interface TypeScriptSemanticCompilerViewInput {
  /** Backend identity attached to this compiler view. */
  readonly identity: SemanticBackendIdentity
  /** TypeScript program that owns source files and compiler options. */
  readonly program: ts.Program
  /** Type checker paired with the program. */
  readonly checker: ts.TypeChecker
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
  const { checker, identity, program } = input

  return {
    identity,
    sourceFiles(files) {
      const selected = new Set(files)
      return program
        .getSourceFiles()
        .filter((sourceFile): sourceFile is ts.SourceFile & SemanticCompilerSourceFile =>
          selected.has(sourceFile.fileName),
        )
    },
    sourceFile(node) {
      return node.getSourceFile() as ts.SourceFile & SemanticCompilerSourceFile
    },
    sourceText(node) {
      return node.getText()
    },
    childNodes(node) {
      const children: ts.Node[] = []
      ts.forEachChild(node, (child) => {
        children.push(child)
      })
      return children
    },
    symbolsAt(nodes) {
      return nodes.map((node) => checker.getSymbolAtLocation(node))
    },
    resolvedSymbols(nodes) {
      return nodes.map((node) => {
        const symbol = shorthandAssignmentValueSymbol(node, checker) ?? checker.getSymbolAtLocation(node)
        return symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol
      })
    },
    shorthandAssignmentValueSymbols(nodes) {
      return nodes.map((node) => shorthandAssignmentValueSymbol(node, checker))
    },
    typesAt(nodes) {
      return nodes.map((node) => checker.getTypeAtLocation(node))
    },
    typeStrings(types, enclosing) {
      return types.map((type) => checker.typeToString(type, enclosing))
    },
    declarationsOf(symbols) {
      return symbols.map((symbol) => symbol.declarations ?? [])
    },
  }
}

function shorthandAssignmentValueSymbol(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (!ts.isIdentifier(node) || !ts.isShorthandPropertyAssignment(node.parent)) return undefined
  return checker.getShorthandAssignmentValueSymbol(node.parent)
}
