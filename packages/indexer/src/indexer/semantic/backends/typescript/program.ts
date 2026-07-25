import ts from "typescript";
import type { SemanticSourceProfile } from "../../source-profile";
import {
  measureSemanticTiming,
  type SemanticIndexInstrumentation,
  type SemanticIndexTimingName,
} from "../../instrumentation";
import {
  createTypeScriptModuleResolutionHost,
  type TypeScriptModuleResolutionEvidence,
} from "./module-resolution";

const moduleResolutionEvidenceByProgram = new WeakMap<
  ts.Program,
  TypeScriptModuleResolutionEvidence
>();

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
} as const satisfies ts.CompilerOptions;

/**
 * Creates the TypeScript program used for semantic enrichment.
 *
 * The program is configured for analysis only and intentionally skips emit so
 * index enrichment can run as a bounded background worker.
 */
export interface SemanticProgramOptions {
  /** Previous program to let TypeScript reuse unchanged project structure. */
  readonly oldProgram?: ts.Program;
  /** Preflight source text that is authoritative for this semantic pass. */
  readonly sourceProfile?: SemanticSourceProfile;
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
  /** Package roots intercepted by the current compiler paths configuration. */
  readonly interceptedModuleNames: ReadonlySet<string>;
  /** Create a program, reusing previous compiler state when the identity matches. */
  program(
    files: readonly string[],
    options?: SemanticProgramSessionOptions,
  ): ts.Program;
}

export interface SemanticProgramSessionOptions {
  /** Stable source/config identity for this semantic analysis. */
  readonly identity?: string;
  /** Optional timing hook for program creation or reuse. */
  readonly instrumentation?: SemanticIndexInstrumentation;
  /** Preflight source text that is authoritative for this semantic pass. */
  readonly sourceProfile?: SemanticSourceProfile;
}

/** Creates a bounded semantic program session owned by one backend instance. */
export function createSemanticProgramSession(
  interceptedModuleNames:
    | ReadonlySet<string>
    | (() => ReadonlySet<string>) = new Set(),
): SemanticProgramSession {
  let current: ts.Program | undefined;

  return {
    get interceptedModuleNames() {
      return typeof interceptedModuleNames === "function"
        ? interceptedModuleNames()
        : interceptedModuleNames;
    },
    program(files, options = {}) {
      const previousEvidence =
        current && moduleResolutionEvidenceByProgram.get(current);
      const canReuse =
        current !== undefined &&
        previousEvidence?.dependenciesMatch() !== false;
      const timingName: SemanticIndexTimingName = canReuse
        ? "semantic.program.reuse"
        : "semantic.program.create";
      const program = measureSemanticTiming(
        options.instrumentation,
        timingName,
        () =>
          semanticProgram(files, {
            oldProgram: canReuse ? current : undefined,
            sourceProfile: options.sourceProfile,
          }),
      );
      current = program;
      return program;
    },
  };
}

export function semanticProgram(
  files: readonly string[],
  options: SemanticProgramOptions = {},
): ts.Program {
  const previousEvidence =
    options.oldProgram &&
    moduleResolutionEvidenceByProgram.get(options.oldProgram);
  const host = semanticCompilerHost(options.sourceProfile, previousEvidence);
  const program = ts.createProgram({
    rootNames: [...files],
    options: semanticCompilerOptions,
    oldProgram: options.oldProgram,
    host: host.compilerHost,
  });
  moduleResolutionEvidenceByProgram.set(program, host.evidence);
  return program;
}

/** Returns the module-resolution evidence used by one semantic Program. */
export function semanticProgramModuleResolutionEvidence(
  program: ts.Program,
): TypeScriptModuleResolutionEvidence | undefined {
  return moduleResolutionEvidenceByProgram.get(program);
}

function semanticCompilerHost(
  sourceProfile: SemanticSourceProfile | undefined,
  previousEvidence: TypeScriptModuleResolutionEvidence | undefined,
) {
  const sources = new Map(
    sourceProfile?.files.flatMap((file) =>
      file.source === undefined ? [] : [[file.file, file.source] as const],
    ),
  );
  const host = ts.createCompilerHost(semanticCompilerOptions);
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);

  host.readFile = (fileName) => sources.get(fileName) ?? readFile(fileName);
  host.fileExists = (fileName) => sources.has(fileName) || fileExists(fileName);
  host.getSourceFile = (
    fileName,
    languageVersionOrOptions,
    onError,
    shouldCreateNewSourceFile,
  ) => {
    const source = sources.get(fileName);
    return source === undefined
      ? getSourceFile(
          fileName,
          languageVersionOrOptions,
          onError,
          shouldCreateNewSourceFile,
        )
      : ts.createSourceFile(fileName, source, languageVersionOrOptions, true);
  };
  return createTypeScriptModuleResolutionHost(
    semanticCompilerOptions,
    host,
    previousEvidence,
  );
}

/**
 * Returns only the user source files requested for this semantic pass.
 */
export function semanticProgramSourceFiles(
  program: ts.Program,
  files: readonly string[],
): ts.SourceFile[] {
  return program
    .getSourceFiles()
    .filter((sourceFile) => files.includes(sourceFile.fileName));
}
