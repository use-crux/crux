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
import type { RuntimeManagedTransportBinding } from "./transport/contracts";

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
 * Resolve the executable provider for one inert binding or accepted envelope.
 *
 * @remarks Uses one deterministic identity rule shared by program validation and
 * the normalization runner: `adapterId` / adapter id, `provider`, and
 * `bindingId` / binding id are treated as a set of stable keys. When those keys
 * match more than one executable provider, resolution fails instead of silently
 * choosing lexicographic provider order or a different precedence chain.
 *
 * @param providers - Canonical program providers.
 * @param binding - Inert managed-transport binding or envelope identity fields.
 * @returns The unique matching provider, or `undefined` when absent.
 * @throws When stable identity keys resolve to different executable providers.
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
  const byId = new Map<string, SignalProvider>();
  for (const provider of providers) {
    byId.set(provider.id, provider);
  }

  const matches = new Map<string, SignalProvider>();
  for (const key of providerResolutionKeys(binding)) {
    const provider = byId.get(key);
    if (provider) matches.set(provider.id, provider);
  }

  if (matches.size > 1) {
    const ids = [...matches.keys()].sort(compareText).join("`, `");
    throw createRuntimeError({
      code: "CAPABILITY_MISSING",
      whatFailed:
        "Runtime transport identity keys resolve to different executable Signal providers.",
      why: `Stable adapterId, provider, and bindingId keys must name one provider; they currently match \`${ids}\`.`,
      whatStillWorks:
        "Bindings whose identity keys all point at one program provider remain valid.",
      nextStep:
        "Align adapterId, provider, and bindingId so they resolve to one signalProvider() id, or remove the conflicting provider from createRuntimeProgram({ providers }).",
    });
  }

  for (const provider of matches.values()) {
    return provider;
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
}): readonly string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined): void => {
    if (typeof value !== "string" || seen.has(value)) return;
    seen.add(value);
    keys.push(value);
  };
  if (binding.adapter) {
    add(binding.adapter.id);
    add(binding.adapter.provider);
  }
  add(binding.adapterId);
  add(typeof binding.provider === "string" ? binding.provider : undefined);
  add(binding.id);
  add(binding.bindingId);
  return keys;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
