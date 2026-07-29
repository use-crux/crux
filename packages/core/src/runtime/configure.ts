/**
 * Central configuration for the prompt system.
 *
 * `configure()` builds a prompt/context registry from authored values. Global
 * runtime effects such as middleware, plugins, tokenizer, and devtools are
 * owned by `config()` through the config transaction installer.
 *
 * Pure tree/array → registry helpers live in `./configure-registry`; this
 * module owns the stateful security flags used by resolver defaults.
 *
 * @module
 */

import type { z } from "zod";
import type { AnyPrompt } from "../prompt/prompt-types";
import type { Context } from "../prompt/context-types";
import {
  type ContextInput,
  type PromptInput,
  buildTagIndex,
  collectContexts,
  extractContexts,
  extractPrompts,
} from "./configure-registry";
import { publishConfiguredPromptCatalogue } from "../runtime-bridge/prompt-preview/catalogue";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface ConfigureOptions {
  /**
   * Prompts to register. Accepts a tree from `createPrompts()` or a flat array.
   */
  prompts: PromptInput;

  /**
   * Contexts to register. Accepts a tree from `createContexts()` or a flat array.
   * Optional — contexts referenced via prompts' `use` arrays are auto-collected.
   */
  contexts?: ContextInput;

  /**
   * Auto-escape top-level string input fields before they reach system/prompt functions.
   * Enabled by default. Set to `false` to disable (e.g., when using `safe` tag exclusively).
   * @default true
   */
  autoEscape?: boolean;

  /**
   * Log `console.warn()` when input fields contain suspicious patterns
   * (XML closing tags, instruction overrides, prompt extraction attempts).
   * Defaults to `true` in development (NODE_ENV !== 'production'), `false` in production.
   * Set explicitly to override the default.
   */
  securityWarnings?: boolean;
}

export interface PromptRegistry {
  /** All registered prompts (flat). */
  readonly prompts: readonly AnyPrompt[];
  /** All registered contexts (flat, includes auto-collected from prompts). */
  readonly contexts: readonly Context<z.ZodType>[];

  /** Get a prompt by id. Throws if not found. */
  get(id: string): AnyPrompt;
  /** Find a prompt by id. Returns `undefined` if not found. */
  find(id: string): AnyPrompt | undefined;
  /** List all registered prompts. */
  list(): AnyPrompt[];
  /** Get all prompts matching a specific tag. */
  byTag(tag: string): AnyPrompt[];
  /** Get all prompts matching *all* specified tags (intersection). */
  byTags(tags: string[]): AnyPrompt[];
  /** Get all unique tags across all registered prompts. */
  tags(): string[];

  /** Tear down registry-local resources. Global config teardown is owned by `config()`. */
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────
// Module-level security flags
// ─────────────────────────────────────────────────────────────────

let _autoEscape = true;
let _securityWarnings = false;

/** Whether auto-escape is currently enabled. */
export function isAutoEscapeEnabled(): boolean {
  return _autoEscape;
}

/** Whether security warnings are currently enabled. */
export function isSecurityWarningsEnabled(): boolean {
  return _securityWarnings;
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

/**
 * Create and publish the active process prompt registry.
 *
 * Accepts prompt/context trees or flat arrays. Returns a frozen registry object
 * with methods for looking up prompts by id or tag. This explicit lifecycle
 * also owns the exact-preview catalogue; use {@link config} separately for
 * project and runtime policy.
 *
 * @example
 * ```ts
 * import {
 *   configure,
 *   createPrompts,
 *   createContexts,
 * } from '@use-crux/core'
 *
 * const prompts = createPrompts({
 *   editor: { edit: draftEdit, seo: seoEdit },
 *   agent:  { planner: writerPlanner },
 * })
 *
 * const contexts = createContexts({
 *   brand: { voice: brand, profile: brandProfileContext },
 * })
 *
 * const registry = configure({
 *   prompts,
 *   contexts,
 * })
 *
 * registry.get('draft-edit')   // Prompt by id
 * registry.byTag('editing')    // Prompts by tag
 * registry.dispose()           // Tear down registry-local resources
 * ```
 */
export function configure(options: ConfigureOptions): PromptRegistry {
  return configureRegistry(options, true);
}

/**
 * Build the private registry used while `config()` assembles runtime policy.
 *
 * This intentionally does not publish an empty exact-preview catalogue over a
 * separately configured public prompt registry.
 *
 * @internal
 */
export function configureUnpublished(
  options: ConfigureOptions,
): PromptRegistry {
  return configureRegistry(options, false);
}

function configureRegistry(
  options: ConfigureOptions,
  publishCatalogue: boolean,
): PromptRegistry {
  // Extract flat lists
  const prompts = extractPrompts(options.prompts);
  const explicitContexts = extractContexts(options.contexts);
  const contexts = collectContexts(prompts, explicitContexts);

  // Validate: all prompts must have an id, no duplicates
  const byId = new Map<string, AnyPrompt>();
  for (const p of prompts) {
    if (!p.id) {
      throw new Error("configure: all prompts must have an id");
    }
    if (byId.has(p.id)) {
      throw new Error(`configure: duplicate prompt id "${p.id}"`);
    }
    byId.set(p.id, p);
  }

  // Build tag index
  const tagIndex = buildTagIndex(prompts);

  // Apply registry-owned policy flags.
  _autoEscape = options.autoEscape !== false; // default: true
  _securityWarnings =
    options.securityWarnings ??
    (typeof process !== "undefined" && process.env?.NODE_ENV !== "production");
  const retireCatalogue = publishCatalogue
    ? publishConfiguredPromptCatalogue(prompts)
    : undefined;
  let disposed = false;

  return Object.freeze({
    prompts: Object.freeze([...prompts]),
    contexts: Object.freeze([...contexts]),

    get(id: string) {
      const p = byId.get(id);
      if (!p) throw new Error(`configure: prompt "${id}" not found`);
      return p;
    },

    find(id: string) {
      return byId.get(id);
    },

    list() {
      return [...prompts];
    },

    byTag(tag: string) {
      return tagIndex.get(tag) ?? [];
    },

    byTags(tags: string[]) {
      const sets = tags.map((t) => new Set(tagIndex.get(t) ?? []));
      if (sets.length === 0) return [];
      return [...sets[0]].filter((p) => sets.every((s) => s.has(p)));
    },

    tags() {
      return [...tagIndex.keys()];
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      retireCatalogue?.();
    },
  });
}
