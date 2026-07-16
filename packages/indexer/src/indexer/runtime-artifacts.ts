import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { RuntimeArtifactManifest } from "@use-crux/core/runtime";
import {
  convexGeneratedEntryFile,
  convexTargetEntryFile,
  importSpecifier,
  nextEntryFile,
} from "./runtime-artifacts/entries";
import { generateEvalArtifacts } from "./runtime-artifacts/eval-registry";
import { writeGeneratedFile } from "./runtime-artifacts/generated-files";
import { resolveRuntimeArtifactHost } from "./runtime-artifacts/host";
import {
  diffRuntimeArtifactDrift,
  manifestFromDefinitions,
} from "./runtime-artifacts/manifest";
import { validateTargetExports } from "./runtime-artifacts/target-validation";
import type {
  GenerateRuntimeArtifactsOptions,
  RuntimeArtifactGenerationResult,
} from "./runtime-artifacts/types";

export {
  diffRuntimeArtifactDrift,
  manifestFromDefinitions,
} from "./runtime-artifacts/manifest";
export type {
  GenerateRuntimeArtifactsOptions,
  RuntimeArtifactDriftReport,
  RuntimeArtifactGenerationResult,
  RuntimeArtifactHost,
  RuntimeArtifactMissingTarget,
} from "./runtime-artifacts/types";

/** Generate the runtime manifest and default Next/Convex entry files for a project. */
export async function generateRuntimeArtifacts(
  options: GenerateRuntimeArtifactsOptions,
): Promise<RuntimeArtifactGenerationResult> {
  const host = await resolveRuntimeArtifactHost(options);
  const nextFile = join(options.root, "crux.generated/next.ts");
  const convexGeneratedFile = join(options.root, "convex/_crux/generated.ts");
  const convexTargetsFile = join(options.root, "convex/_crux/targets.ts");
  const evalOutputFile = host === "next" ? nextFile : convexTargetsFile;
  const evalArtifacts = await generateEvalArtifacts({
    root: options.root,
    outputFile: evalOutputFile,
    definitions: options.definitions ?? [],
    importSpecifier: (relativeFile) =>
      importSpecifier(
        dirname(evalOutputFile),
        join(options.root, relativeFile),
      ),
  });
  const manifest: RuntimeArtifactManifest = {
    ...manifestFromDefinitions({
      root: options.root,
      definitions: options.definitions ?? [],
    }),
    evals: evalArtifacts.manifestEntries,
  };
  await validateTargetExports(options.root, manifest.targets);
  const canonicalManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  const contentHash = createHash("sha256")
    .update(canonicalManifest)
    .digest("hex");

  const manifestFile = join(
    options.root,
    ".crux/generated/runtime/manifest.json",
  );
  const writtenFiles: string[] = [];
  if (await writeGeneratedFile(manifestFile, canonicalManifest)) {
    writtenFiles.push(manifestFile);
  }
  if (
    host === "next" &&
    (await writeGeneratedFile(
      nextFile,
      nextEntryFile({
        manifest,
        outputFile: nextFile,
        root: options.root,
        manifestHash: contentHash,
        evalArtifacts,
      }),
      { protect: true },
    ))
  ) {
    writtenFiles.push(nextFile);
  }
  if (host === "convex") {
    if (
      await writeGeneratedFile(
        convexGeneratedFile,
        convexGeneratedEntryFile(),
        { protect: true },
      )
    ) {
      writtenFiles.push(convexGeneratedFile);
    }
    if (
      await writeGeneratedFile(
        convexTargetsFile,
        convexTargetEntryFile({
          manifest,
          outputFile: convexTargetsFile,
          root: options.root,
          evalArtifacts,
        }),
        { protect: true },
      )
    ) {
      writtenFiles.push(convexTargetsFile);
    }
  }

  return {
    manifest,
    contentHash,
    writtenFiles,
  };
}
