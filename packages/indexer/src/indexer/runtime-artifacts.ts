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
import {
  commitRuntimeArtifactPlan,
  createRuntimeArtifactPlan,
  preflightRuntimeArtifactPlan,
  type RuntimeArtifactPlanFile,
} from "./runtime-artifacts/generated-files";
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
  const convexTargetsFile = join(options.root, "convex/_crux/targets.ts");
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

  const privacySnapshot = `${JSON.stringify(
    {
      schemaVersion: 1,
      privacyFingerprint: evalArtifacts.privacyFingerprint,
      redactPaths: evalArtifacts.redactPaths,
    },
    null,
    2,
  )}\n`;
  const files: RuntimeArtifactPlanFile[] = [
    {
      destination: ".crux/generated/runtime/manifest.json",
      contents: canonicalManifest,
      ownership: "crux-owned",
      activationOrder: Number.MAX_SAFE_INTEGER,
    },
    {
      destination: ".crux/generated/runtime/privacy.json",
      contents: privacySnapshot,
      ownership: "crux-owned",
      activationOrder: 0,
    },
  ];
  if (host === "next") {
    files.push({
      destination: "crux.generated/next.ts",
      contents: nextEntryFile({
        manifest,
        outputFile: nextFile,
        root: options.root,
        manifestHash: contentHash,
        evalArtifacts,
      }),
      ownership: "generated-marker",
      activationOrder: 10,
    });
  }
  if (host === "convex") {
    files.push(
      {
        destination: "convex/_crux/generated.ts",
        contents: convexGeneratedEntryFile(),
        ownership: "generated-marker",
        activationOrder: 10,
      },
      {
        destination: "convex/_crux/targets.ts",
        contents: convexTargetEntryFile({
          manifest,
          outputFile: convexTargetsFile,
          root: options.root,
          evalArtifacts,
        }),
        ownership: "generated-marker",
        activationOrder: 20,
      },
      {
        destination: "convex/_crux/http.ts",
        contents: convexHttpRoutesFile(),
        ownership: "generated-marker",
        activationOrder: 30,
      },
      {
        destination: "convex/http.ts",
        contents: convexHttpEntryFile(),
        ownership: "generated-marker",
        activationOrder: 40,
        conflictNextStep:
          "Keep the existing router, import `registerCruxEvalRoutes` from `./_crux/http`, call it with that router, then run `crux runtime generate` again.",
      },
    );
  }
  if (host === "cloudflare") {
    files.push({
      destination: "cloudflare/_crux/generated.ts",
      contents: cloudflareGeneratedEntryFile({
        manifest,
        outputFile: cloudflareGeneratedFile,
        root: options.root,
        evalArtifacts,
      }),
      ownership: "generated-marker",
      activationOrder: 10,
    });
  }

  const plan = createRuntimeArtifactPlan({ root: options.root, files });
  const prepared = await preflightRuntimeArtifactPlan(plan);
  const writtenFiles = await commitRuntimeArtifactPlan(prepared);

  return {
    manifest,
    contentHash,
    writtenFiles,
  };
}
