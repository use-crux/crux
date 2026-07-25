import ts from "typescript";

/**
 * Returns module names whose exact package-root identity is intercepted by
 * compiler `paths` configuration.
 *
 * Config parsing is delegated to TypeScript so inherited configuration follows
 * the compiler's own semantics. Unreadable discovered configs fail closed.
 */
export function interceptedCanonicalModuleNames(
  tsconfigFiles: readonly string[],
  moduleNames: readonly string[],
): ReadonlySet<string> {
  if (tsconfigFiles.length === 0 || moduleNames.length === 0) return new Set();
  const intercepted = new Set<string>();
  for (const configFile of tsconfigFiles) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      configFile,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic() {},
      },
    );
    if (!parsed) return new Set(moduleNames);
    for (const moduleName of moduleNames) {
      if (pathsInterceptModule(parsed.options.paths, moduleName)) {
        intercepted.add(moduleName);
      }
    }
  }
  return intercepted;
}

/** Returns whether any configured paths pattern can match one exact module. */
export function pathsInterceptModule(
  paths: Readonly<Record<string, readonly string[]>> | undefined,
  moduleName: string,
): boolean {
  return Object.keys(paths ?? {}).some((pattern) =>
    pathsPatternMatches(pattern, moduleName),
  );
}

function pathsPatternMatches(pattern: string, moduleName: string): boolean {
  const wildcard = pattern.indexOf("*");
  if (wildcard < 0) return pattern === moduleName;
  if (pattern.indexOf("*", wildcard + 1) >= 0) return true;
  return (
    moduleName.startsWith(pattern.slice(0, wildcard)) &&
    moduleName.endsWith(pattern.slice(wildcard + 1))
  );
}
