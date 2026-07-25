import ts from "typescript";
import type { SemanticCacheValidationDependencyCollector } from "../../cache-validation";
import { semanticValueExportTerminal } from "../../model/export-provenance";
import { tagSite } from "./export-symbols";
import {
  createTypeScriptExportRoutes,
  type TypeScriptCanonicalPackageRoot,
} from "./export-routes";
import type { TypeScriptModuleResolutionEvidence } from "./module-resolution";
import { createTypeScriptPackageExportIdentity } from "./package-export-identity";

export interface TypeScriptCanonicalExportIdentityInput {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly moduleResolution: TypeScriptModuleResolutionEvidence | undefined;
  readonly interceptedModuleNames: ReadonlySet<string>;
  readonly validationDependencies?: SemanticCacheValidationDependencyCollector;
}

/** Creates tag-site canonical package export proof for one TypeScript Program. */
export function createTypeScriptCanonicalExportIdentity(
  input: TypeScriptCanonicalExportIdentityInput,
): (node: ts.Node, moduleName: string, exportName: string) => boolean {
  const symbolIds = new Map<ts.Symbol, number>();
  let nextSymbolId = 1;
  const packageExportIdentity = createTypeScriptPackageExportIdentity(input);

  return (node, moduleName, exportName) => {
    if (input.interceptedModuleNames.has(moduleName)) return false;
    const site = tagSite(node, input.checker);
    if (!site) return false;
    const packageTerminals = new Map<string, ts.Symbol>();
    const canonicalPackageRoot: TypeScriptCanonicalPackageRoot = (
      moduleSpecifier,
      module,
      expectedModuleName,
    ) => {
      const terminal = packageExportIdentity(
        moduleSpecifier,
        module,
        expectedModuleName,
        exportName,
      );
      if (!terminal) return false;
      packageTerminals.set(symbolKey(terminal), terminal);
      return true;
    };
    const exportRoutes = createTypeScriptExportRoutes(
      input.checker,
      canonicalPackageRoot,
    );
    const root = exportRoutes.root(
      site.declaration,
      site.exportName,
      moduleName,
    );
    if (!root) return false;
    const terminal = semanticValueExportTerminal({
      module: root.module,
      exportName: root.exportName,
      canonicalPackageRoot: canonicalPackageRoot(
        root.moduleSpecifier,
        root.module,
        moduleName,
      ),
      view: {
        moduleKey: symbolKey,
        terminalKey: symbolKey,
        routes: exportRoutes.routes,
      },
    });
    return (
      terminal !== undefined &&
      terminal === site.terminal &&
      packageTerminals.size === 1 &&
      packageTerminals.has(symbolKey(terminal))
    );
  };

  function symbolKey(symbol: ts.Symbol): string {
    const existing = symbolIds.get(symbol);
    if (existing) return String(existing);
    const id = nextSymbolId;
    nextSymbolId += 1;
    symbolIds.set(symbol, id);
    return String(id);
  }
}
