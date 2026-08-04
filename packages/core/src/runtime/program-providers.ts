/**
 * Executable Signal-provider authority for immutable Runtime programs.
 *
 * @remarks Live providers sit beside targets as process authority. They never
 * enter inert `RuntimeManagedTransportBinding` declarations or secret-bearing
 * manifest data. Resolution is by stable provider/adapter/binding identity.
 *
 * @module
 */

import type { SignalProvider } from "../signal/provider";
import { createRuntimeError } from "./engine/errors";
import type { RuntimeManagedTransportBinding } from "./transport";

/** Secret-free provider identity retained in the program manifest hash. */
export interface RuntimeProgramProviderManifestEntry {
  readonly id: string;
}

/**
 * Canonicalize explicitly imported Signal providers.
 *
 * @param providers - Live provider definitions imported by the host or program.
 * @returns Frozen providers ordered by stable id.
 * @throws When a value is not a Signal provider or ids collide.
 */
export function canonicalizeProgramProviders(
  providers: readonly SignalProvider[],
): readonly SignalProvider[] {
  const canonical = [...providers].sort((left, right) =>
    compareText(left.id, right.id),
  );
  for (let index = 0; index < canonical.length; index += 1) {
    const provider = canonical[index]!;
    if (provider?._tag !== "SignalProvider" || typeof provider.id !== "string") {
      throw createRuntimeError({
        code: "RUNTIME_ARTIFACT_MANIFEST_INVALID",
        whatFailed: "Runtime program provider is not a Signal provider definition.",
        why: "Executable transport authority requires frozen signalProvider() values.",
        whatStillWorks: "Inert transport bindings and other program targets remain valid.",
        nextStep:
          "Pass definitions created by signalProvider({ id, transport, signals, onEvent }).",
      });
    }
    if (index > 0 && canonical[index - 1]!.id === provider.id) {
      throw createRuntimeError({
        code: "TARGET_DUPLICATE",
        whatFailed: `Runtime Signal provider \`${provider.id}\` is declared more than once.`,
        why: "A Runtime program needs one executable definition per provider identity.",
        whatStillWorks:
          "Other uniquely identified providers, targets, and bindings remain valid.",
        nextStep: `Remove or rename the duplicate provider \`${provider.id}\`.`,
      });
    }
  }
  return Object.freeze(canonical);
}

/**
 * Require every managed-transport binding to resolve to one program provider.
 *
 * @param providers - Canonical executable providers.
 * @param transports - Inert managed-transport bindings.
 * @throws When a binding has no matching provider or identity is inconsistent.
 */
export function validateProgramProviderBindings(
  providers: readonly SignalProvider[],
  transports: readonly RuntimeManagedTransportBinding[],
): void {
  for (const transport of transports) {
    if (resolveProgramProvider(providers, transport)) continue;
    throw createRuntimeError({
      code: "CAPABILITY_MISSING",
      whatFailed: `Runtime transport binding \`${transport.id}\` has no executable Signal provider.`,
      why: "Managed-transport normalization requires an explicitly imported provider for each binding.",
      whatStillWorks:
        "Bindings whose adapter/provider identity matches a program provider remain valid.",
      nextStep:
        `Import a signalProvider() whose id matches adapter \`${transport.adapter.id}\` or provider \`${transport.adapter.provider}\`, and pass it to createRuntimeProgram({ providers }).`,
    });
  }
}

/**
 * Resolve the executable provider for one inert binding.
 *
 * @param providers - Canonical program providers.
 * @param binding - Inert managed-transport binding or envelope identity fields.
 * @returns The matching provider, or `undefined` when absent.
 */
export function resolveProgramProvider(
  providers: readonly SignalProvider[],
  binding: {
    readonly id?: string;
    readonly adapter?: { readonly id: string; readonly provider: string };
    readonly adapterId?: string;
    readonly provider?: string;
    readonly bindingId?: string;
  },
): SignalProvider | undefined {
  const keys = providerResolutionKeys(binding);
  for (const provider of providers) {
    if (keys.has(provider.id)) return provider;
  }
  return undefined;
}

/** Secret-free manifest projection for program hashing. */
export function providerManifestEntry(
  provider: SignalProvider,
): RuntimeProgramProviderManifestEntry {
  return Object.freeze({ id: provider.id });
}

function providerResolutionKeys(binding: {
  readonly id?: string;
  readonly adapter?: { readonly id: string; readonly provider: string };
  readonly adapterId?: string;
  readonly provider?: string;
  readonly bindingId?: string;
}): ReadonlySet<string> {
  const keys = new Set<string>();
  if (binding.adapter) {
    keys.add(binding.adapter.id);
    keys.add(binding.adapter.provider);
  }
  if (typeof binding.adapterId === "string") keys.add(binding.adapterId);
  if (typeof binding.provider === "string") keys.add(binding.provider);
  if (typeof binding.id === "string") keys.add(binding.id);
  if (typeof binding.bindingId === "string") keys.add(binding.bindingId);
  return keys;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
