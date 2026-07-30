/** Fully qualified, client-only PromptText highlighting switch. */
export const promptTextDecorationsConfiguration =
  'crux.promptText.decorations.enabled'

/**
 * Minimal configuration reader used by the production VS Code adapter.
 *
 * Keeping this structural prevents the controller and its tests from
 * depending on the extension-host module.
 */
export interface PromptTextConfigurationReader {
  /**
   * @param section - Fully qualified configuration key.
   * @param defaultValue - Value used when the key is absent or malformed.
   * @returns The current window-scoped configuration value.
   */
  get<T>(section: string, defaultValue: T): T
}

/**
 * Read whether PromptText highlighting is currently enabled.
 *
 * @param configuration - VS Code-compatible configuration reader.
 * @returns `true` unless the dedicated client setting is explicitly disabled.
 */
export function readPromptTextDecorationsEnabled(
  configuration: PromptTextConfigurationReader,
): boolean {
  return configuration.get(promptTextDecorationsConfiguration, true)
}
