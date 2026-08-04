import { dirname, join } from "node:path";
import type { RuntimeArtifactManifest } from "@use-crux/core/runtime";
import { importSpecifier } from "./import-specifier";

/** Render provider import statements for the generated Runtime program. */
export function providerImports(
  manifest: RuntimeArtifactManifest,
  outputFile: string,
  root: string,
): string[] {
  return (manifest.providers ?? []).map((provider, index) => {
    const sourceFile = join(root, provider.module.replace(/^\.\//, ""));
    const specifier = importSpecifier(dirname(outputFile), sourceFile);
    return `import { ${provider.export} as ${providerLocalName(index)} } from '${specifier}'`;
  });
}

/** Render transport-binding import statements for the generated Runtime program. */
export function transportImports(
  manifest: RuntimeArtifactManifest,
  outputFile: string,
  root: string,
): string[] {
  return (manifest.transports ?? []).map((transport, index) => {
    const sourceFile = join(root, transport.module.replace(/^\.\//, ""));
    const specifier = importSpecifier(dirname(outputFile), sourceFile);
    return `import { ${transport.export} as ${transportLocalName(index)} } from '${specifier}'`;
  });
}

/** Local binding names for statically imported providers. */
export function providerLocalNames(manifest: RuntimeArtifactManifest): string[] {
  return (manifest.providers ?? []).map((_, index) => providerLocalName(index));
}

/** Local binding names for statically imported transport bindings. */
export function transportLocalNames(manifest: RuntimeArtifactManifest): string[] {
  return (manifest.transports ?? []).map((_, index) => transportLocalName(index));
}

function providerLocalName(index: number): string {
  return `provider${index}`;
}

function transportLocalName(index: number): string {
  return `transport${index}`;
}
