import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isSourceFile,
  type SourceFile,
} from "@typescript/native-preview/unstable/ast";
import type {
  Project,
  Symbol as TsgoSymbol,
} from "@typescript/native-preview/unstable/sync";
import { sha256 } from "../../../cache-identity";
import type { SemanticCacheValidationDependencyCollector } from "../../cache-validation";

interface ReadablePackageManifestEvidence {
  readonly valid: boolean;
  readonly file: string;
  readonly digest: string;
}

type PackageManifestEvidence =
  | ReadablePackageManifestEvidence
  | { readonly valid: false };

/**
 * Creates exact package-manifest identity proof for one native project.
 *
 * Only the manifest directory selected by TypeScript-Go is read. Results are
 * cached per exact directory for the lifetime of the analysis.
 */
export function createTsgoPackageManifestIdentity(
  project: Project,
  validationDependencies:
    | SemanticCacheValidationDependencyCollector
    | undefined,
): (module: TsgoSymbol, moduleName: string) => boolean {
  const evidenceByDirectory = new Map<string, PackageManifestEvidence>();

  return (module, moduleName) => {
    const sources = module.declarations
      .map((handle) => handle.resolve(project))
      .filter((node): node is SourceFile =>
        Boolean(node && isSourceFile(node)),
      );
    if (sources.length !== 1) {
      validationDependencies?.invalidate();
      return false;
    }

    const directory = project.program.getSourceFileMetadata(
      sources[0].fileName,
    )?.packageJsonDirectory;
    if (!directory) {
      validationDependencies?.invalidate();
      return false;
    }

    const evidence =
      evidenceByDirectory.get(directory) ??
      readPackageManifestEvidence(directory, moduleName);
    evidenceByDirectory.set(directory, evidence);
    if ("file" in evidence) {
      validationDependencies?.record({
        file: evidence.file,
        digest: evidence.digest,
      });
    }
    if (!evidence.valid) validationDependencies?.invalidate();
    return evidence.valid;
  };
}

function readPackageManifestEvidence(
  directory: string,
  moduleName: string,
): PackageManifestEvidence {
  const file = join(directory, "package.json");
  let source: Buffer;
  try {
    source = readFileSync(file);
  } catch {
    return { valid: false };
  }
  const digest = sha256(source);
  try {
    const parsed = JSON.parse(source.toString("utf8")) as unknown;
    const valid = Boolean(
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.prototype.hasOwnProperty.call(parsed, "name") &&
      (parsed as { readonly name?: unknown }).name === moduleName,
    );
    return { valid, file, digest };
  } catch {
    return { valid: false, file, digest };
  }
}
