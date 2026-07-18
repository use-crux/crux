import { createRuntimeError } from "@use-crux/core/runtime";
import { loadProjectConfig } from "../config";
import type {
  GenerateRuntimeArtifactsOptions,
  RuntimeArtifactHost,
} from "./types";

/** Resolve the explicit or project-configured runtime artifact host. */
export async function resolveRuntimeArtifactHost(
  options: GenerateRuntimeArtifactsOptions,
): Promise<RuntimeArtifactHost> {
  if (options.host) return options.host;
  const loaded = await loadProjectConfig(
    options.root,
    undefined,
    "runtime-rich",
  );
  const runtime = loaded.loaded.crux?.config.runtime;
  if (runtime?.kind === "host-bound") {
    if (runtime.host === "convex") return "convex";
    if (runtime.host === "cloudflare") return "cloudflare";
  }
  if (loaded.loaded.configFile && !loaded.loaded.crux) {
    throw createRuntimeError({
      code: "SETUP_REQUIRED",
      whatFailed:
        "Crux runtime artifacts could not resolve the configured runtime host.",
      why: `The config file \`${loaded.loaded.configFile}\` did not load to a Crux config object, so the generator cannot choose a host entry safely.`,
      whatStillWorks: "The runtime manifest and entry files are unchanged.",
      nextStep:
        "Fix crux.config.ts or pass an explicit host to crux runtime generate.",
    });
  }
  return "next";
}
