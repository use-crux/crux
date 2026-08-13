/**
 * Work policy `use`-entry type contract.
 *
 * Compiled via `tsc --noEmit` only — no runtime behavior.
 */

import { expectTypeOf } from "vitest";
import { prompt, workPolicy } from "@use-crux/core";

// Authoring options are partial overrides: every top-level and tree limit is
// optional, so authors declare only the limits they care about.
workPolicy({ concurrency: 4 });
workPolicy({ concurrency: 4, maxOutstanding: 16 });
workPolicy({ tree: { maxDepth: 2 } });
workPolicy({ tree: { maxStarts: 64, maxActive: 16 } });
workPolicy({ concurrency: 4, tree: { maxDepth: 2 } });

// A prompt that `use`s a work policy compiles, and the policy contributes no
// input requirements: resolve accepts an empty input object.
const policyPrompt = prompt({
  use: [workPolicy({ concurrency: 4 })],
  system: "static system",
});
policyPrompt.resolve({});
expectTypeOf(policyPrompt.resolve)
  .parameter(0)
  .toMatchTypeOf<{ input?: undefined }>();
expectTypeOf(policyPrompt.resolve).returns.resolves.toMatchTypeOf<
  import("@use-crux/core").ResolvedPrompt
>();
