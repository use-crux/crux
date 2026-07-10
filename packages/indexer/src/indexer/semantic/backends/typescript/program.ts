import ts from 'typescript'
import {
  measureSemanticTiming,
  type SemanticIndexInstrumentation,
  type SemanticIndexTimingName,
} from '../../instrumentation'

/**
 * Compiler options for semantic enrichment.
 *
 * `types: []` prevents TypeScript from loading visible ambient `@types/*`
 * packages for semantic facts that are derived from project source imports.
 * That keeps the semantic worker smaller without changing authored source
 * roots or local dependency resolution.
 */
export const semanticCompilerOptions = {
  allowJs: false,
  noEmit: true,
  skipLibCheck: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  strict: false,
  types: [],
} as const satisfies ts.CompilerOptions

/**
 * Creates the TypeScript program used for semantic enrichment.
 *
 * The program is configured for analysis only and intentionally skips emit so
 * index enrichment can run as a bounded background worker.
 */
export interface SemanticProgramOptions {
  /** Previous program to let TypeScript reuse unchanged project structure. */
  readonly oldProgram?: ts.Program
}

/**
 * Backend-owned reusable TypeScript project state.
 *
 * The session keeps the previous program inside one backend project identity.
 * TypeScript's `oldProgram` path revalidates changed source files while
 * reusing unchanged compiler structure, so callers do not need to prove an
 * identical source hash before receiving incremental compiler reuse.
 */
export interface SemanticProgramSession {
  /** Create a program, reusing previous compiler state when the identity matches. */
  program(files: readonly string[], options?: SemanticProgramSessionOptions): ts.Program
}

export interface SemanticProgramSessionOptions {
  /** Stable source/config identity for this semantic analysis. */
  readonly identity?: string
  /** Optional timing hook for program creation or reuse. */
  readonly instrumentation?: SemanticIndexInstrumentation
}

/** Creates a bounded semantic program session owned by one backend instance. */
export function createSemanticProgramSession(): SemanticProgramSession {
  let current: ts.Program | undefined

  return {
    program(files, options = {}) {
      const canReuse = current !== undefined
      const timingName: SemanticIndexTimingName = canReuse ? 'semantic.program.reuse' : 'semantic.program.create'
      const program = measureSemanticTiming(options.instrumentation, timingName, () =>
        semanticProgram(files, { oldProgram: current }),
      )
      current = program
      return program
    },
  }
}

export function semanticProgram(files: readonly string[], options: SemanticProgramOptions = {}): ts.Program {
  return ts.createProgram({
    rootNames: [...files],
    options: semanticCompilerOptions,
    oldProgram: options.oldProgram,
  })
}

/**
 * Returns only the user source files requested for this semantic pass.
 */
export function semanticProgramSourceFiles(program: ts.Program, files: readonly string[]): ts.SourceFile[] {
  return program.getSourceFiles().filter((sourceFile) => files.includes(sourceFile.fileName))
}
