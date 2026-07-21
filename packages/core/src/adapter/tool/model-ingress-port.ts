import type { ModelIngressGuard } from '../../safety/input/model-ingress'

/**
 * Private loop-runtime hook that guards tools in their native output dialect.
 *
 * The runtime installs this wrapper before Core instruments `toModelOutput()`,
 * so accepted-result observation sees only the guarded native value.
 *
 * @internal
 */
export const toolModelIngressDialect: unique symbol = Symbol(
  'crux.adapter.toolModelIngressDialect',
)

/** @internal Dialect-owned native tool wrapper using Core's semantic ingress port. */
export interface ToolModelIngressDialect {
  (
    tools: Record<string, unknown>,
    guard: ModelIngressGuard,
    options: { readonly provider?: string },
  ): Record<string, unknown>
}
