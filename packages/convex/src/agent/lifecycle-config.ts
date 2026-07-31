import type { ConvexAgentPassthroughOptions } from './driver'
import type { AnyConvexPrompt, ProfileBackedAgentLifecycleConfig } from './lifecycle-types'

/** Strip Crux-owned lifecycle fields before forwarding options to Convex Agent. */
export function agentOptionsFromConfig<TPrompt extends AnyConvexPrompt>(
  config: ProfileBackedAgentLifecycleConfig<TPrompt>,
): ConvexAgentPassthroughOptions {
  const {
    components: _components,
    driver: _driver,
    languageModel: _languageModel,
    model: _model,
    namespace: _namespace,
    name: _name,
    observe: _observe,
    persistence: _persistence,
    prepare: _prepare,
    prompt: _prompt,
    store: _store,
    tools: _tools,
    ...agentOptions
  } = config
  void _components
  void _driver
  void _languageModel
  void _model
  void _namespace
  void _name
  void _observe
  void _persistence
  void _prepare
  void _prompt
  void _store
  void _tools
  return agentOptions
}
