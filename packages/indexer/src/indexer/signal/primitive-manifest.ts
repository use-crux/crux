import {
  extractManagedTransportBindingStaticFacts,
  extractPollingStaticFacts,
  extractSignalProviderStaticFacts,
  extractSignalStaticFacts,
  extractStreamStaticFacts,
  extractWebhookStaticFacts,
} from "./static-facts";
import { providerModules, signalModules, transportModules } from "./modules";

/** Declarative TypeScript compatibility coverage for authored Signals. */
export const signalPrimitiveContributions = Object.freeze({
  extractors: [
    {
      name: "signal",
      patterns: [
        {
          kind: "call" as const,
          name: "signal",
          importFrom: signalModules,
          configArg: 0,
        },
      ],
      extract: extractSignalStaticFacts,
    },
    {
      name: "signal.transport",
      patterns: [
        {
          kind: "call" as const,
          name: "webhook",
          importFrom: transportModules,
          configArg: 0,
        },
      ],
      extract: extractWebhookStaticFacts,
    },
    {
      name: "signal.transport.polling",
      patterns: [
        {
          kind: "call" as const,
          name: "polling",
          importFrom: transportModules,
          configArg: 0,
        },
      ],
      extract: extractPollingStaticFacts,
    },
    {
      name: "signal.transport.stream",
      patterns: [
        {
          kind: "call" as const,
          name: "stream",
          importFrom: transportModules,
          configArg: 0,
        },
      ],
      extract: extractStreamStaticFacts,
    },
    {
      name: "signal.provider",
      patterns: [
        {
          kind: "call" as const,
          name: "signalProvider",
          importFrom: providerModules,
          configArg: 0,
        },
      ],
      extract: extractSignalProviderStaticFacts,
    },
    {
      name: "signal.transportBinding",
      patterns: [
        {
          kind: "call" as const,
          name: "managedTransportBinding",
          importFrom: providerModules,
        },
      ],
      extract: extractManagedTransportBindingStaticFacts,
    },
  ],
  relations: [
    {
      type: "signal.provider.uses_transport",
      fromKinds: ["signal.provider"] as const,
      toKinds: ["signal.transport"] as const,
      presentation: "both" as const,
      fidelity: "resolved" as const,
      runtimeJoin: false,
    },
    {
      type: "signal.provider.publishes_signal",
      fromKinds: ["signal.provider"] as const,
      toKinds: ["signal"] as const,
      presentation: "both" as const,
      fidelity: "resolved" as const,
      runtimeJoin: false,
    },
    {
      type: "signal.transportBinding.binds_provider",
      fromKinds: ["signal.transportBinding"] as const,
      toKinds: ["signal.provider"] as const,
      presentation: "both" as const,
      fidelity: "resolved" as const,
      runtimeJoin: true,
    },
    {
      type: "signal.transportBinding.targets_signal",
      fromKinds: ["signal.transportBinding"] as const,
      toKinds: ["signal"] as const,
      presentation: "both" as const,
      fidelity: "resolved" as const,
      runtimeJoin: true,
    },
  ],
});
