import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { RuntimeArtifactManifest } from "@use-crux/core/runtime";
import {
  cloudflareGeneratedEntryFile,
  convexGeneratedEntryFile,
  convexHttpEntryFile,
  convexHttpRoutesFile,
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
import { loadProjectConfig } from "./config";

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
  const projectConfig = await loadProjectConfig(
    options.root,
    undefined,
    "runtime-rich",
  );
  if (projectConfig.loaded.configFile && !projectConfig.loaded.crux) {
    throw new TypeError(
      `Crux runtime artifacts could not load '${projectConfig.loaded.configFile}' to project the Eval privacy policy. Fix crux.config.ts, then run crux runtime generate again.`,
    );
  }
  const nextFile = join(options.root, "crux.generated/next.ts");
  const convexGeneratedFile = join(options.root, "convex/_crux/generated.ts");
  const convexTargetsFile = join(options.root, "convex/_crux/targets.ts");
  const convexHttpFile = join(options.root, "convex/http.ts");
  const convexHttpRoutesOutputFile = join(options.root, "convex/_crux/http.ts");
  const cloudflareGeneratedFile = join(
    options.root,
    "cloudflare/_crux/generated.ts",
  );
  const evalOutputFile =
    host === "next"
      ? nextFile
      : host === "convex"
        ? convexTargetsFile
        : cloudflareGeneratedFile;
  const evalArtifacts = await generateEvalArtifacts({
    root: options.root,
    outputFile: evalOutputFile,
    definitions: options.definitions ?? [],
    importSpecifier: (relativeFile) =>
      importSpecifier(
        dirname(evalOutputFile),
        join(options.root, relativeFile),
      ),
    redactPaths:
      projectConfig.loaded.crux?.config.observability?.redactPaths ?? [],
  });
  const manifest: RuntimeArtifactManifest = {
    ...manifestFromDefinitions({
      root: options.root,
      definitions: options.definitions ?? [],
      evalPrivacyFingerprint: evalArtifacts.privacyFingerprint,
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
  const privacyFile = join(
    options.root,
    ".crux/generated/runtime/privacy.json",
  );
  const writtenFiles: string[] = [];
  if (await writeGeneratedFile(manifestFile, canonicalManifest)) {
    writtenFiles.push(manifestFile);
  }
  const privacySnapshot = `${JSON.stringify(
    {
      schemaVersion: 1,
      privacyFingerprint: evalArtifacts.privacyFingerprint,
      redactPaths: evalArtifacts.redactPaths,
    },
    null,
    2,
  )}\n`;
  if (await writeGeneratedFile(privacyFile, privacySnapshot)) {
    writtenFiles.push(privacyFile);
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
    if (
      await writeGeneratedFile(
        convexHttpRoutesOutputFile,
        convexHttpRoutesFile(),
        { protect: true },
      )
    ) {
      writtenFiles.push(convexHttpRoutesOutputFile);
    }
    if (
      await writeGeneratedFile(convexHttpFile, convexHttpEntryFile(), {
        protect: true,
        conflictNextStep:
          "Keep the existing router, import `registerCruxEvalRoutes` from `./_crux/http`, call it with that router, then run `crux runtime generate` again.",
      })
    ) {
      writtenFiles.push(convexHttpFile);
    }
  }
  if (
    host === "cloudflare" &&
    (await writeGeneratedFile(
      cloudflareGeneratedFile,
      cloudflareGeneratedEntryFile({
        manifest,
        outputFile: cloudflareGeneratedFile,
        root: options.root,
        evalArtifacts,
      }),
      { protect: true },
    ))
  ) {
    writtenFiles.push(cloudflareGeneratedFile);
  }

  return {
    manifest,
    contentHash,
    writtenFiles,
  };
}
