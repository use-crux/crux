import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import ts from "typescript";
import { sha256 } from "../../../cache-identity";
import type { SemanticCacheValidationDependency } from "../../cache-validation";

export interface TypeScriptActiveModuleResolution {
  readonly resolvedModule: ts.ResolvedModuleFull | undefined;
}

/** Active Program-host module resolutions and consulted package manifests. */
export interface TypeScriptModuleResolutionEvidence {
  readonly resolution: (
    containingFile: string,
    literal: ts.StringLiteralLike,
  ) => TypeScriptActiveModuleResolution | undefined;
  readonly validationDependencies: () => readonly SemanticCacheValidationDependency[];
  readonly invalidate: () => void;
  readonly dependenciesMatch: () => boolean;
}

export interface TypeScriptModuleResolutionHost {
  readonly compilerHost: ts.CompilerHost;
  readonly evidence: TypeScriptModuleResolutionEvidence;
}

/** Creates the resolver used by a Program and retains its exact evidence. */
export function createTypeScriptModuleResolutionHost(
  compilerOptions: ts.CompilerOptions,
  compilerHost: ts.CompilerHost,
  previous?: TypeScriptModuleResolutionEvidence,
): TypeScriptModuleResolutionHost {
  const resolutions = new Map<string, TypeScriptActiveModuleResolution>();
  const dependencies = new Map<string, string>();
  let valid = true;
  for (const dependency of previous?.validationDependencies() ?? []) {
    dependencies.set(dependency.file, dependency.digest);
  }
  const resolutionCache = ts.createModuleResolutionCache(
    compilerHost.getCurrentDirectory(),
    compilerHost.getCanonicalFileName,
    compilerOptions,
  );
  const resolutionHost: ts.ModuleResolutionHost = {
    fileExists: compilerHost.fileExists.bind(compilerHost),
    readFile(fileName) {
      const source = compilerHost.readFile(fileName);
      if (source !== undefined && basename(fileName) === "package.json") {
        dependencies.set(resolve(fileName), sha256(source));
      }
      return source;
    },
    directoryExists: compilerHost.directoryExists?.bind(compilerHost),
    getCurrentDirectory: compilerHost.getCurrentDirectory.bind(compilerHost),
    getDirectories: compilerHost.getDirectories?.bind(compilerHost),
    realpath: compilerHost.realpath?.bind(compilerHost),
    trace: compilerHost.trace?.bind(compilerHost),
    useCaseSensitiveFileNames:
      typeof compilerHost.useCaseSensitiveFileNames === "function"
        ? compilerHost.useCaseSensitiveFileNames()
        : compilerHost.useCaseSensitiveFileNames,
  };

  const evidence: TypeScriptModuleResolutionEvidence = {
    resolution(containingFile, literal) {
      return (
        resolutions.get(resolutionKey(containingFile, literal)) ??
        previous?.resolution(containingFile, literal)
      );
    },
    validationDependencies() {
      return [...dependencies]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([file, digest]) => ({ file, digest }));
    },
    invalidate() {
      valid = false;
    },
    dependenciesMatch() {
      try {
        return (
          valid &&
          [...dependencies].every(
            ([file, digest]) => sha256(readFileSync(file)) === digest,
          )
        );
      } catch {
        return false;
      }
    },
  };

  compilerHost.resolveModuleNameLiterals = (
    moduleLiterals,
    containingFile,
    redirectedReference,
    options,
    containingSourceFile,
  ) =>
    moduleLiterals.map((literal) => {
      const resolved = ts.resolveModuleName(
        literal.text,
        containingFile,
        options,
        resolutionHost,
        resolutionCache,
        redirectedReference,
        ts.getModeForUsageLocation(containingSourceFile, literal, options),
      );
      resolutions.set(resolutionKey(containingFile, literal), {
        resolvedModule: resolved.resolvedModule,
      });
      return resolved;
    });

  return { compilerHost, evidence };
}

function resolutionKey(
  containingFile: string,
  literal: ts.StringLiteralLike,
): string {
  return [resolve(containingFile), literal.pos, literal.end, literal.text].join(
    "\0",
  );
}
