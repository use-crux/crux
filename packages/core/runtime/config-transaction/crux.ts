import type { PromptRegistry } from '../configure'
import type { Crux } from '../config'
import type { CruxConfig } from '../config-types'

export type { Crux } from '../config'

/** Factory responsible for the public frozen `Crux` object shape. */
export interface RuntimeConfigCruxFactory {
  /** Create a normal `Crux` object from an installed prompt registry. */
  create(config: Readonly<CruxConfig>, registry: PromptRegistry): Crux
  /** Create an inert `Crux` object for index mode without touching globals. */
  createInert(config: Readonly<CruxConfig>): Crux
}

/** Default `Crux` object factory used by the public `config()` API. */
export const defaultRuntimeConfigCruxFactory: RuntimeConfigCruxFactory = {
  create(config, registry) {
    return Object.freeze({
      ...registry,
      config: Object.freeze({ ...config }),
    }) as Crux
  },
  createInert(config) {
    return Object.freeze({
      prompts: Object.freeze([]),
      contexts: Object.freeze([]),
      get(id: string) {
        throw new Error(`configure: prompt "${id}" not found`)
      },
      find() {
        return undefined
      },
      list() {
        return []
      },
      byTag() {
        return []
      },
      byTags() {
        return []
      },
      tags() {
        return []
      },
      config: Object.freeze({ ...config }),
      dispose() {},
    }) as Crux
  },
}
