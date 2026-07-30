import type {
  ClientCapabilities,
  StaticFeature,
} from 'vscode-languageclient/node'

/**
 * Advertise support for the payload-free PromptText refresh request.
 *
 * The feature contributes only initialize-time capability data. Refresh
 * handling remains owned by the PromptText VS Code controller, so there are no
 * listeners to initialize or clear here.
 *
 * @returns A static language-client feature registered before client startup.
 */
export function createPromptTextRefreshFeature(): StaticFeature {
  return Object.freeze({
    fillClientCapabilities(capabilities: ClientCapabilities): void {
      capabilities.experimental = withPromptTextRefresh(
        capabilities.experimental,
      )
    },
    initialize(): void {},
    getState: () => ({ kind: 'static' }),
    clear(): void {},
  } satisfies StaticFeature)
}

function withPromptTextRefresh(
  value: unknown,
): Readonly<Record<string, unknown>> {
  const experimental = isRecord(value) ? value : {}
  const crux = isRecord(experimental.crux) ? experimental.crux : {}
  const promptText = isRecord(crux.promptText) ? crux.promptText : {}
  return {
    ...experimental,
    crux: {
      ...crux,
      promptText: {
        ...promptText,
        refreshSupport: true,
      },
    },
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
