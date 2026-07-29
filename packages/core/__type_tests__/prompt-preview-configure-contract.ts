/**
 * Public exact-preview catalogue authority contract.
 *
 * `configure()` owns an explicit prompt-registry lifecycle at the package
 * root. Project/runtime policy remains owned by `config()`, and the published
 * Runtime Engine subpath must not become a second catalogue authority.
 */

import {
  configure,
  type ConfigureOptions,
  type PromptRegistry,
} from "@use-crux/core";
import { expectTypeOf } from "vitest";

// @ts-expect-error — the Runtime Engine subpath is not a catalogue authority.
import { configure as runtimeConfigure } from "@use-crux/core/runtime";

expectTypeOf(configure).toEqualTypeOf<
  (options: ConfigureOptions) => PromptRegistry
>();
void runtimeConfigure;
