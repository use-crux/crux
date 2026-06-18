import ts from 'typescript'

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
export function semanticProgram(files: readonly string[]): ts.Program {
  return ts.createProgram({
    rootNames: [...files],
    options: semanticCompilerOptions,
  })
}

/**
 * Returns only the user source files requested for this semantic pass.
 */
export function semanticProgramSourceFiles(program: ts.Program, files: readonly string[]): ts.SourceFile[] {
  return program.getSourceFiles().filter((sourceFile) => files.includes(sourceFile.fileName))
}
