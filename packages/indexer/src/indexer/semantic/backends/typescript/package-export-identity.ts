import ts from "typescript";
import type { SemanticCacheValidationDependencyCollector } from "../../cache-validation";
import { canonicalSymbol } from "./export-symbols";
import type { TypeScriptModuleResolutionEvidence } from "./module-resolution";

export interface TypeScriptPackageExportIdentityInput {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly moduleResolution: TypeScriptModuleResolutionEvidence | undefined;
  readonly validationDependencies?: SemanticCacheValidationDependencyCollector;
}

/**
 * Creates exact compiler-selected public package export identity proof.
 *
 * A successful proof returns the requested module export's terminal symbol so
 * callers can compare it with the terminal reached from the authored tag.
 */
export function createTypeScriptPackageExportIdentity(
  input: TypeScriptPackageExportIdentityInput,
): (
  moduleSpecifier: ts.StringLiteralLike,
  module: ts.Symbol,
  expectedModuleName: string,
  expectedExportName: string,
) => ts.Symbol | undefined {
  return (moduleSpecifier, module, expectedModuleName, expectedExportName) => {
    const moduleName = expectedModuleName || moduleSpecifier.text;
    const packageName = packageRootName(moduleName);
    if (
      moduleName !== moduleSpecifier.text ||
      packageName !== "@use-crux/core"
    ) {
      return undefined;
    }
    const resolution = input.moduleResolution?.resolution(
      moduleSpecifier.getSourceFile().fileName,
      moduleSpecifier,
    )?.resolvedModule;
    const dependencies = input.moduleResolution?.validationDependencies() ?? [];
    for (const dependency of dependencies) {
      input.validationDependencies?.record(dependency);
    }
    if (dependencies.length === 0 || !resolution?.packageId?.name) {
      input.validationDependencies?.invalidate();
      input.moduleResolution?.invalidate();
      return undefined;
    }
    if (resolution.packageId.name !== packageName) return undefined;
    const resolvedSource = input.program.getSourceFile(
      resolution.resolvedFileName,
    );
    if (
      !resolvedSource ||
      !module.declarations?.some(
        (declaration) =>
          ts.isSourceFile(declaration) && declaration === resolvedSource,
      )
    ) {
      return undefined;
    }
    return canonicalSymbol(
      input.checker
        .getExportsOfModule(module)
        .find((symbol) => symbol.getName() === expectedExportName),
      input.checker,
    );
  };
}

function packageRootName(moduleName: string): string {
  const segments = moduleName.split("/");
  return moduleName.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? moduleName);
}
