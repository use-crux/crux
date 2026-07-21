import type { SemanticAnalyzerSourceFile, SemanticAnalyzerView } from '../../candidates'
import type { SemanticIndexInstrumentation } from '../../instrumentation'
import type { SemanticSourceProfile } from '../../source-profile'
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
  /** Preflight source text shared with the compiler program host. */
  readonly sourceProfile?: SemanticSourceProfile
}

export interface SemanticSourceFileFactInput<TView extends SemanticAnalyzerView = TypeScriptSemanticCompilerView> {
  /** Absolute Project Index root used for module-scoped definition ids. */
  readonly root: string
  /** Source files selected for candidate discovery. */
  readonly sourceFiles: readonly SemanticAnalyzerSourceFile<TView>[]
  /** Backend-owned compiler view used for semantic resolution. */
  readonly view: TView
}

/** Creates source files and a compiler view for the JavaScript TypeScript backend. */
export function createTypeScriptSemanticFactInput(
  root: string,
  files: readonly string[],
  options: SemanticIndexFactsOptions = {},
): SemanticSourceFileFactInput {
  const program = options.programSession
    ? options.programSession.program(files, {
        identity: options.programIdentity,
        instrumentation: options.instrumentation,
        sourceProfile: options.sourceProfile,
      })
    : measureSemanticTiming(options.instrumentation, 'semantic.program.create', () =>
        semanticProgram(files, { sourceProfile: options.sourceProfile }),
      )
  const checker = measureSemanticTiming(options.instrumentation, 'semantic.checker.create', () =>
    program.getTypeChecker(),
  )
  const view = createTypeScriptSemanticCompilerView({
    identity: { name: 'typescript', version: 'v1' },
    program,
    checker,
  })
  return {
    root,
    sourceFiles: view.sourceFiles(files),
    view,
  }
}
