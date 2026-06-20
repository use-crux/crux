import ts from 'typescript'
import type { SemanticAnalyzerView } from './candidates'
import type { SemanticIndexInstrumentation } from './instrumentation'
import { measureSemanticTiming } from './instrumentation'
import { semanticProgram, semanticProgramSourceFiles, type SemanticProgramSession } from './program'
import { createTypeScriptSemanticCompilerView } from './typescript-compiler-view'

export interface SemanticIndexFactsOptions {
  /** Optional timing hook for semantic analyzer phases. */
  readonly instrumentation?: SemanticIndexInstrumentation
  /** Backend-owned TypeScript project state for safe reuse. */
  readonly programSession?: SemanticProgramSession
  /** Stable source/config identity used to decide whether program state can be reused. */
  readonly programIdentity?: string
}

export interface SemanticSourceFileFactInput {
  /** Source files selected for candidate discovery. */
  readonly sourceFiles: readonly ts.SourceFile[]
  /** Backend-owned compiler view used for semantic resolution. */
  readonly view: SemanticAnalyzerView
}

/** Creates source files and a compiler view for the JavaScript TypeScript backend. */
export function createTypeScriptSemanticFactInput(
  files: readonly string[],
  options: SemanticIndexFactsOptions = {},
): SemanticSourceFileFactInput {
  const program = options.programSession
    ? options.programSession.program(files, {
        identity: options.programIdentity,
        instrumentation: options.instrumentation,
      })
    : measureSemanticTiming(options.instrumentation, 'semantic.program.create', () => semanticProgram(files))
  const checker = measureSemanticTiming(options.instrumentation, 'semantic.checker.create', () =>
    program.getTypeChecker(),
  )
  const view = createTypeScriptSemanticCompilerView({
    identity: { name: 'typescript', version: 'v1' },
    program,
    checker,
  })
  return {
    sourceFiles: semanticProgramSourceFiles(program, files),
    view,
  }
}
