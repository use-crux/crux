import type { SemanticAnalyzerSourceFile, SemanticAnalyzerView } from '../../candidates'
import type { SemanticIndexInstrumentation } from '../../instrumentation'
import { measureSemanticTiming } from '../../instrumentation'
import { semanticProgram, type SemanticProgramSession } from './program'
import { createTypeScriptSemanticCompilerView, type TypeScriptSemanticCompilerView } from './compiler-view'

export interface SemanticIndexFactsOptions {
  /** Optional timing hook for semantic analyzer phases. */
  readonly instrumentation?: SemanticIndexInstrumentation
  /** Backend-owned TypeScript project state for safe reuse. */
  readonly programSession?: SemanticProgramSession
  /** Stable source/config identity used to decide whether program state can be reused. */
  readonly programIdentity?: string
}

export interface SemanticSourceFileFactInput<TView extends SemanticAnalyzerView = TypeScriptSemanticCompilerView> {
  /** Source files selected for candidate discovery. */
  readonly sourceFiles: readonly SemanticAnalyzerSourceFile<TView>[]
  /** Backend-owned compiler view used for semantic resolution. */
  readonly view: TView
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
    sourceFiles: view.sourceFiles(files),
    view,
  }
}
