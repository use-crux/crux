/** Modules that author first-party Signal definitions. */
export const signalModules = ["@use-crux/core", "@use-crux/core/signal"] as const;

/** Modules that author Signal providers and managed bindings. */
export const providerModules = [
  "@use-crux/core",
  "@use-crux/core/signal/provider",
] as const;

/** Modules that author webhook and polling transports. */
export const transportModules = [
  "@use-crux/core",
  "@use-crux/core/signal/transport",
] as const;
