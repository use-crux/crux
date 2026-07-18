import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RuntimeEngineDefinition } from "../../runtime/api/runtime-definition";
import type { CruxExperimentalEvalConfig } from "../../runtime/eval-config";
import {
  DEFAULT_EVAL_PERSISTENCE_POLICY,
  fingerprintEvalPersistencePolicy,
  normalizeEvalPersistencePolicy,
  type EvalPersistencePolicy,
} from "../internal/redact";

const CONFIG_NAMES = ["crux.config.ts", "crux.config.js", "crux.config.mjs"];
const GENERATED_PRIVACY_PATH = ".crux/generated/runtime/privacy.json";
const GENERATED_PRIVACY_KEYS = Object.freeze([
  "privacyFingerprint",
  "redactPaths",
  "schemaVersion",
]);
let indexModeQueue: Promise<void> = Promise.resolve();

export interface ProjectEvalSettings {
  readonly runtime?: RuntimeEngineDefinition;
  readonly pricing?: CruxExperimentalEvalConfig["pricing"];
  readonly persistencePolicy: EvalPersistencePolicy;
}

/** Load only inert Eval settings from the authored project configuration. */
export async function loadProjectEvalSettings(
  projectRoot: string,
): Promise<ProjectEvalSettings> {
  const configFile = await findConfig(projectRoot);
  if (configFile === undefined) {
    return Object.freeze({
      persistencePolicy: DEFAULT_EVAL_PERSISTENCE_POLICY,
    });
  }
  const loaded = await withIndexMode(
    async () =>
      (await import(pathToFileURL(configFile).href)) as {
        readonly default?: {
          readonly config?: {
            readonly runtime?: unknown;
            readonly experimental?: {
              readonly eval?: { readonly pricing?: unknown };
            };
            readonly observability?: { readonly redactPaths?: unknown };
          };
        };
      },
  );
  const config = loaded.default?.config;
  const persistencePolicy = normalizeEvalPersistencePolicy({
    redactPaths: config?.observability?.redactPaths,
  });
  const pricing = normalizePricing(config?.experimental?.eval?.pricing);
  return Object.freeze({
    ...(config?.runtime !== undefined
      ? { runtime: config.runtime as RuntimeEngineDefinition }
      : {}),
    ...(pricing !== undefined ? { pricing } : {}),
    persistencePolicy,
  });
}

/**
 * Load the generated data-only privacy policy without importing project code.
 * Strict offline Eval planning uses this projection so it remains network- and
 * adapter-free without ever falling back to a less restrictive policy.
 */
export async function loadGeneratedEvalPersistencePolicy(
  projectRoot: string,
): Promise<EvalPersistencePolicy> {
  const path = join(projectRoot, GENERATED_PRIVACY_PATH);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw generatedPrivacyPolicyUnavailable(cause);
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\u0000") !==
      GENERATED_PRIVACY_KEYS.join("\u0000")
  ) {
    throw generatedPrivacyPolicyUnavailable();
  }
  const snapshot = value as Record<string, unknown>;
  if (snapshot.schemaVersion !== 1) {
    throw generatedPrivacyPolicyUnavailable();
  }
  let policy: EvalPersistencePolicy;
  try {
    policy = normalizeEvalPersistencePolicy({
      redactPaths: snapshot.redactPaths,
    });
  } catch (cause) {
    throw generatedPrivacyPolicyUnavailable(cause);
  }
  if (
    snapshot.privacyFingerprint !==
    fingerprintEvalPersistencePolicy(policy)
  ) {
    throw generatedPrivacyPolicyUnavailable();
  }
  return policy;
}

function generatedPrivacyPolicyUnavailable(cause?: unknown): TypeError {
  return new TypeError(
    "Project privacy policy is not ready for strict offline Evals. Run `crux runtime generate`, then retry.",
    cause === undefined ? undefined : { cause },
  );
}

function normalizePricing(
  value: unknown,
): CruxExperimentalEvalConfig["pricing"] {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      "experimental.eval.pricing must be a model-keyed object of maxUsdPerCall ceilings.",
    );
  }
  const pricing = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(pricing)) {
    const ceiling =
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>).maxUsdPerCall
        : undefined;
    if (
      typeof ceiling !== "number" ||
      !Number.isFinite(ceiling) ||
      ceiling < 0
    ) {
      throw new TypeError(
        `experimental.eval.pricing['${key}'].maxUsdPerCall must be finite and non-negative.`,
      );
    }
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(pricing).map(([key, entry]) => [
        key,
        Object.freeze({
          maxUsdPerCall: (entry as { maxUsdPerCall: number }).maxUsdPerCall,
        }),
      ]),
    ),
  );
}

async function findConfig(projectRoot: string): Promise<string | undefined> {
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
      `Crux configuration is ambiguous: ${matches.join(", ")}. Keep one crux.config.ts/js/mjs for this invocation.`,
    );
  }
  return matches[0];
}

async function withIndexMode<T>(task: () => Promise<T>): Promise<T> {
  const run = indexModeQueue.then(async () => {
    const previous = process.env.CRUX_INDEX;
    process.env.CRUX_INDEX = "1";
    try {
      return await task();
    } finally {
      if (previous === undefined) delete process.env.CRUX_INDEX;
      else process.env.CRUX_INDEX = previous;
    }
  });
  indexModeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
