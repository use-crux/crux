/** Settings and client state sent once when the language server starts. */
export interface InitializationOptionsInput {
  readonly port: number
  readonly profile: string
  readonly includeSuppressed: boolean
  readonly trace: string
  readonly workspaceTrust: boolean
}

/** Initialization payload understood by the Crux language server. */
export interface CruxInitializationOptions {
  readonly workspaceTrust: boolean
  readonly crux: {
    readonly port: number
    readonly lint: {
      readonly profile: string
      readonly includeSuppressed: boolean
    }
    readonly trace: string
  }
}

/** Configuration sections eligible for runtime synchronization with the server. */
export const serverConfigurationSections = [
  'crux.port',
  'crux.lint',
  'crux.trace',
] as const

/**
 * Creates the initialization payload understood by the language server.
 *
 * Workspace trust intentionally sits outside `crux`: it describes the host
 * session, while the nested values are user-controlled Crux settings. VS Code
 * passes true because the extension host keeps this extension inert before
 * trust; the field remains meaningful for other protocol hosts.
 */
export function createInitializationOptions({
  port,
  profile,
  includeSuppressed,
  trace,
  workspaceTrust,
}: InitializationOptionsInput): CruxInitializationOptions {
  return {
    workspaceTrust,
    crux: {
      port,
      lint: { profile, includeSuppressed },
      trace,
    },
  }
}
