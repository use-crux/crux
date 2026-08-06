# Adapter-Bound Generation Model Session Types

Status: **approved API direction awaiting user specification review for issue #338**

Exact Agent and Session signatures and inference rules for the
[adapter-bound generation model design](./2026-08-03-adapter-bound-generation-model-design.md).
API surface illustrations live in the
[adapter-bound generation model API contract](./2026-08-03-adapter-bound-generation-model-api.md).
Behavioral authority remains in the design document.

## Agent and Session typing

Agent retains the exact model type instead of widening to `TModel | undefined`:

```ts
export interface Agent<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
  TModel extends RoutableModel | undefined = undefined,
> {
  readonly model: TModel
  // existing fields unchanged
}

export type AgentModel<A extends AnyAgent> = A['model']
export type AgentRequiredCapabilities<A extends AnyAgent> =
  RequiredLanguageCapabilities<A['prompt'], A['tools']>

type SessionModelField<
  A extends AnyAgent,
  M extends GenerationModel | undefined,
> = [AgentModel<A>] extends [GenerationModel]
  ? { readonly model?: M }
  : { readonly model: M }

export type SessionOptions<
  A extends AnyAgent,
  M extends GenerationModel | undefined,
> = {
  readonly key?: string
  readonly thread?: Thread
} & SessionModelField<A, M>

type ResolvedSessionModel<
  A extends AnyAgent,
  M extends GenerationModel | undefined,
> = M extends GenerationModel ? M : Extract<AgentModel<A>, GenerationModel>

/** Brand shown when inferred model evidence lacks a required Agent facet. */
type IncompatibleGenerationModelError<
  A extends AnyAgent,
  M extends GenerationModel,
> = {
  readonly __cruxIncompatibleGenerationModel: {
    readonly message: 'The supplied GenerationModel cannot execute this Agent'
    readonly required: AgentRequiredCapabilities<A>
    readonly available: CapabilitiesOf<M>
  }
}

type SessionModelGuard<
  A extends AnyAgent,
  M extends GenerationModel | undefined,
> = [ResolvedSessionModel<A, M>] extends [never]
  ? {
      readonly __cruxMissingGenerationModelBinding: 'Bind a GenerationModel on the Agent or Session'
    }
  : Supports<
        CapabilitiesOf<Extract<ResolvedSessionModel<A, M>, GenerationModel>>,
        AgentRequiredCapabilities<A>
      > extends false
    ? IncompatibleGenerationModelError<
        A,
        Extract<ResolvedSessionModel<A, M>, GenerationModel>
      >
    : unknown

/**
 * Create or reopen the canonical durable Session for an exact Agent type.
 *
 * @example
 * ```ts
 * const bound = agent({ id: 'bound', prompt: taskPrompt, model: economy })
 * const ready = await session(bound, { key: 'account:7' })
 * const supplied = await session(unbound, { key: 'account:8', model: economy })
 * ```
 */
export declare function session<
  const A extends AnyAgent,
  const M extends GenerationModel | undefined = undefined,
>(
  target: A,
  options: SessionOptions<A, M> & SessionModelGuard<A, M>,
): Promise<Session<InferAgentInput<A>, InferAgentOutput<A>>>
```

## Inference and capability checking

One conditional signature, not an overload family. `M` is inferred from the
plain `model: M` field; the guard is intersected with the options parameter only
after that inference. Exact Agent input/output is preserved; `model` stays
optional when the Agent is already bound. Factory and helper generics need no
assertions. A raw native Agent model fails the bound branch, so Session requires
a bound override.

`RequiredLanguageCapabilities` always requires text generation; adds Tool calls
when the effective Agent graph exposes Tools; adds structured output for an
output schema; and adds statically visible input modalities.

Capability evidence:

- **Exact catalog** — literal native-model or literal route-leaf evidence yields
  exact readonly capability tuples. Known missing required facets make
  `Supports<...> extends false` and reject at compile time.
- **Broad evidence** — broad native interfaces and non-literal route leaves are
  conservative. The call is permitted without a compile-time guarantee and
  requires generated-program preflight.
- **Runtime preflight** — dynamic context, route, Tool, and media requirements
  are checked before Session state or provider I/O. Router capability
  intersection is exact only when every leaf has literal evidence.

Composition-level and `prepareStep` amendments use the same model slot and
compatibility relation. In durable execution, an amendment may select only a
statically declared `GenerationModel`.
