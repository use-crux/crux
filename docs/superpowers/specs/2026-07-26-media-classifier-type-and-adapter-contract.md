# Media classifier type and adapter contract

Status: **approved companion to the
[media classifier design](./2026-07-26-media-classifier-guardrail-design.md)**

## Public types

```ts
export interface MediaClassifierCategory {
  /** Stable identifier used in thresholds, findings, and observability. */
  readonly id: string

  /**
   * Plain-language classification criterion given to the judge.
   *
   * Describe what evidence qualifies rather than supplying only a label.
   */
  readonly description: string
}

export type MediaClassifierModality = MediaPart['type']

export type MediaClassifierAction = Exclude<
  MediaGuardrailRunResult['action'],
  'allow'
>

export type MediaClassifierUnsupportedAction =
  MediaGuardrailRunResult['action']

export type MediaClassifierOptions<
  TCategories extends readonly [
    MediaClassifierCategory,
    ...MediaClassifierCategory[],
  ],
> = {
  /** Structured-generation function supplied by a compatible Crux adapter. */
  readonly generate: GenerateObjectFn

  /** Multimodal-capable model passed to `generate`. */
  readonly model: unknown

  /** Non-empty ordered categories evaluated for every included part. */
  readonly categories: TCategories

  /** Required inclusive default score threshold between 0 and 1. */
  readonly threshold: number

  /** Overrides keyed by inferred category id. */
  readonly thresholds?: Partial<
    Record<TCategories[number]['id'], number>
  >

  /**
   * Action returned when any category reaches its threshold.
   *
   * @default 'block'
   */
  readonly action?: MediaClassifierAction

  /**
   * Canonical media kinds inspected by this strategy.
   *
   * `file` includes documents such as PDF and DOCX.
   *
   * @default ['image', 'audio', 'video', 'file']
   */
  readonly modalities?: readonly [
    MediaClassifierModality,
    ...MediaClassifierModality[],
  ]

  /**
   * Action returned when the adapter/model cannot inspect an in-scope part.
   *
   * Omission rethrows UnsupportedCapabilityError unchanged. Other generation
   * failures always propagate.
   */
  readonly unsupported?: MediaClassifierUnsupportedAction
}
```

The factory uses a const type parameter:

```ts
export function mediaClassifier<
  const TCategories extends readonly [
    MediaClassifierCategory,
    ...MediaClassifierCategory[],
  ],
>(
  options: MediaClassifierOptions<TCategories>,
): GuardrailRun<MediaBoundary>
```

Literal category IDs therefore flow into `thresholds` without `as const`.
Unknown keys fail at compile time when categories remain literal. Runtime
validation still covers JavaScript and widened TypeScript values:

- categories are non-empty;
- IDs match `^[a-z][a-z0-9._-]{0,63}$`;
- descriptions are non-empty after trimming;
- IDs are unique;
- thresholds are finite and within `[0, 1]`;
- explicit modalities are non-empty and unique; and
- actions use the exact accepted vocabularies.

`threshold` is required because a caller-authored rubric has no universally
safe default.

## Structured-generation port

`GenerateObjectFn` gains the prompt/message exclusivity already used by
`GenerateTextFn`:

```ts
interface GenerateObjectCommonOptions<T> {
  readonly model: unknown
  readonly system?: string
  readonly schema: z.ZodType<T>
  readonly temperature?: number
  readonly topP?: number
}

type GenerateObjectInput =
  | {
      readonly prompt: string
      readonly messages?: never
    }
  | {
      readonly messages: readonly Message[]
      readonly prompt?: never
    }

export type GenerateObjectFn = <T>(
  options: GenerateObjectCommonOptions<T> & GenerateObjectInput,
) => Promise<{
  readonly object: T
  readonly routing?: RoutingReceipt
}>
```

The classifier sends one canonical user message containing rubric text
followed by the media part. It preserves source, MIME type, and filename, but
drops `providerOptions`; options from the protected call must not leak into a
potentially different classifier adapter.

Core does not download URLs, hydrate `AssetRef`, or convert parts into provider
objects. The provider may perform normal media I/O inside the explicit
classifier generation call.

That call is a separate media-disclosure boundary. Documentation must state
that the selected classifier provider receives the media, which may differ
from the provider handling the protected generation. Provider-owned file
references may be non-portable across that boundary and fail capability
validation before classifier provider I/O.

The widened contract applies equally to:

- `@use-crux/openai`;
- `@use-crux/anthropic`;
- `@use-crux/google`;
- `@use-crux/ai`;
- the shared native-chat provider helper; and
- `createGenerateObjectFnFromGenerate()`.

Provider packages reuse their canonical media codecs. Core does not claim
uniform model support or maintain a capability table.

This widening is source-breaking for third-party `GenerateObjectFn`
implementers because they must accept both input forms. That cost is accepted
instead of introducing a competing media-only port.

Examples should prefer each adapter's lightweight
`createGenerateObjectFn()` helper. The adapter-backed
`createGenerateObjectFnFromGenerate()` bridge remains supported, but its JSDoc
must explain that it executes the full prompt lifecycle. Users must not wire
the same guardrail recursively through that lifecycle.

## Model resolution contract

The native adapter factories become unbound:

```ts
const generate = createGenerateObjectFn(client)

await generate({
  model: 'gpt-5-mini',
  messages,
  schema,
})
```

Every first-party implementation must resolve `options.model` for every call:

- OpenAI, Anthropic, and Google GenAI accept a non-empty provider model string;
- AI SDK continues to resolve its opaque model value through its existing
  model resolver; and
- adapter-backed generation continues to forward the call's model through the
  normal prompt lifecycle.

Core intentionally keeps `model: unknown`. This permits AI SDK model objects,
application routing references, and future adapter-specific model references
without coupling Core to a provider SDK.

Native helpers reject an incompatible or empty model value with an actionable
`TypeError` before request construction or provider I/O. There is no bound
model overload, default-model fallback, or precedence rule: the one visible
`options.model` value is authoritative.

This cleanup ships with the already-breaking prompt/messages widening. It
removes the existing constructor model argument rather than preserving two
ways to select a model, one of which could be silently ignored.

## Prompt and response

The system prompt is versioned by
`MEDIA_CLASSIFIER_PROMPT_VERSION`. It must:

- identify classification rather than general assistance;
- treat media, documents, filenames, and embedded text as untrusted evidence;
- define scores as normalized confidence that a criterion is satisfied;
- require one independent score for every category;
- forbid invented or omitted keys; and
- avoid requesting OCR, transcription, identifiers, or free-form description.

The provider-facing schema contains scores only:

```ts
{
  scores: {
    'sexual-content': 0.04,
    'graphic-violence': 0.91,
  },
}
```

Core builds a strict object schema from category IDs and validates the returned
object even when the injected function claims to have applied the schema.
Free-form explanations are excluded because they can reproduce sensitive
content and add tokens and schema failure modes.

The guardrail reason is deterministic:

```text
Media classifier matched graphic-violence (0.91 >= 0.90).
```

## Migration

Third-party ports branch on the exclusive input:

```ts
const generateObject: GenerateObjectFn = async (options) => {
  const input =
    'prompt' in options
      ? convertPrompt(options.prompt)
      : convertMessages(options.messages)

  return callProvider({ ...options, input })
}
```

Provider/schema/abort errors retain their existing identity throughout this
bridge.

Native helper construction changes from:

```ts
const generate = createGenerateObjectFn(client, 'gpt-5-mini')
```

to:

```ts
const generate = createGenerateObjectFn(client)

await generate({
  model: 'gpt-5-mini',
  prompt: '...',
  schema,
})
```

Calls that already supplied the same model in both places remove only the
constructor argument. Internal retrieval extensions follow the same
single-source model contract.
