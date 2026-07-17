import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RuntimeEngineDefinition } from "../../../runtime/api/runtime-definition";

const CONFIG_NAMES = ["crux.config.ts", "crux.config.js", "crux.config.mjs"];

/** Load the project's one selected Runtime declaration through its normal module cache. */
export async function loadSelectedRuntimeDefinition(
  projectRoot: string,
): Promise<RuntimeEngineDefinition | undefined> {
  const matches: string[] = [];
  for (const name of CONFIG_NAMES) {
    const path = resolve(projectRoot, name);
    try {
      await access(path);
      matches.push(path);
    } catch {}
  }
  if (matches.length > 1) {
    throw new TypeError(
      `Crux Runtime selection is ambiguous: ${matches.join(", ")}. Keep one crux.config.ts/js/mjs for this invocation.`,
    );
  }
  if (!matches[0]) return undefined;
  const loaded = (await import(pathToFileURL(matches[0]).href)) as {
    readonly default?: { readonly config?: { readonly runtime?: unknown } };
  };
  return loaded.default?.config?.runtime as RuntimeEngineDefinition | undefined;
}
