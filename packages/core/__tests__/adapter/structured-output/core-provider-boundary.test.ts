/**
 * Import-boundary guard — `@use-crux/core` stays provider-agnostic (RFC #224).
 *
 * A binding rule of the rollout is that the structured-output compiler lives in
 * core and owns finite, provider-neutral lowering rules; no provider SDK may be
 * imported by core. This scanner fails if any core source module imports a known
 * provider SDK, guarding the invariant as compiler modules land in later phases.
 *
 * This test is expected to PASS today and must keep passing every phase.
 *
 * @module
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const coreSrc = join(here, "..", "..", "..", "src");

/**
 * Bare specifiers (or specifier prefixes) that would couple core to a provider
 * SDK or host framework. `@use-crux/*` and relative imports are always allowed.
 */
const FORBIDDEN_SPECIFIERS: readonly string[] = [
  "openai",
  "@openai/",
  "@anthropic-ai/",
  "anthropic",
  "@google/genai",
  "@google/generative-ai",
  "@google-cloud/",
  "@ai-sdk/",
  "ai/",
  "ai", // Vercel AI SDK
];

function listTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

/** Extract every static/dynamic import + re-export specifier from a module. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function isForbidden(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("@use-crux/")) {
    return false;
  }
  return FORBIDDEN_SPECIFIERS.some(
    (forbidden) =>
      specifier === forbidden ||
      (forbidden.endsWith("/") && specifier.startsWith(forbidden)),
  );
}

describe("core stays provider-agnostic", () => {
  it("has no provider SDK imports in any src module", () => {
    const offenders: string[] = [];
    for (const file of listTypeScriptFiles(coreSrc)) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        if (isForbidden(specifier)) {
          offenders.push(`${file} imports "${specifier}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
