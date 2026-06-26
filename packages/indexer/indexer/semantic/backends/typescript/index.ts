/**
 * JavaScript TypeScript semantic backend.
 *
 * This backend is the correctness baseline for semantic Project Index facts. It
 * owns `ts.Program` and `TypeChecker` usage internally and exports only Crux
 * semantic evidence and compiler-view contracts.
 *
 * @module
 */

export {
  createTypeScriptSemanticBackend,
  typescriptSemanticBackendCapabilities,
  typescriptSemanticBackendIdentity,
  type TypeScriptSemanticBackendOptions,
} from './backend'
export {
  createTypeScriptSemanticCompilerView,
  type TypeScriptSemanticCompilerViewInput,
  type TypeScriptSemanticCompilerView,
} from './compiler-view'
export {
  createTypeScriptSemanticSyntaxView,
  type TypeScriptSemanticSyntaxNode,
  type TypeScriptSemanticSyntaxSourceFile,
  type TypeScriptSemanticSyntaxView,
  type TypeScriptSemanticSyntaxViewInput,
} from './syntax-view'
export {
  createTypeScriptSemanticFactInput,
  type SemanticIndexFactsOptions,
  type SemanticSourceFileFactInput,
} from './fact-input'
export {
  createSemanticProgramSession,
  semanticProgram,
  semanticProgramSourceFiles,
  type SemanticProgramSession,
} from './program'
