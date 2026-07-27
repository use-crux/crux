# Bounded media streaming — Safety contract

Status: **approved**

Parent:
[bounded media streaming design](./2026-07-27-bounded-media-streaming-design.md).

Related: [#199](https://github.com/use-crux/crux/issues/199),
[#285](https://github.com/use-crux/crux/issues/285), generated-image Safety,
generated-speech Safety, media guardrails, global policies, tuning, findings,
routing commitment, and logical streams.

## Governing law

Streaming media uses the existing Safety session, boundary vocabulary,
guardrail modes, decisions, findings, audit, tuning, and global policies.
There is no media-stream-specific guardrail API.

The existing publication law remains binding:

> A public occurrence is final with respect to every Safety stage that could
> still block, strip, or rewrite that occurrence.

Progressive does not mean unguarded. Crux may change release timing when an
active policy requires a complete media subject, but it never weakens policy
behavior or exposes a bypass surface.

## Input parity

Input Safety completes before provider normalization and I/O:

- `streamImage()` guards prompt text with the same operation-text path as
  `generateImage()`;
- reference images and edit masks use the same canonical media traversal,
  retention groups, dependencies, and immutable write-back;
- `streamSpeech()` guards text and optional instructions with the same slots
  as `generateSpeech()`; and
- global policies, call guardrails, per-call tuning, findings, and audit use
  the same compiled Safety session as completed operations.

An input block is terminal and starts no physical provider attempt. Input
rewrites and strips are written into the normalized candidate before routing.

## Progressive media shapes

Output behavior depends on whether a progressive value is a valid closed
`MediaPartSubject`:

| Value                  | Enforcing output-media behavior         |
| ---------------------- | --------------------------------------- |
| Complete image preview | Guard before publication                |
| Incomplete image delta | Hold until final validation             |
| Incomplete audio delta | Hold until final validation             |
| Final image or audio   | Use completed-operation output handling |

A provider label such as "partial" does not decide Safety behavior. A
renderable complete preview is a closed media occurrence. An encoded fragment
that cannot be inspected as an ordinary canonical asset is not.

## Complete previews

Each complete image preview is projected as a canonical image part and passed
through `boundary.output.media()` before publication.

- `allow` publishes the preview.
- `warn` publishes and records audit and findings.
- Enforced `strip` suppresses that preview only.
- Enforced `block` terminates the logical operation.
- Report-mode block or strip records intent without suppressing the preview.

Preview traversal uses a retention minimum of zero: removing one provisional
occurrence does not violate the final result contract. A stripped preview does
not prevent a later preview or final image.

An allowed preview authorizes that closed occurrence only. The final image is
a distinct occurrence and is evaluated independently. It may still warn,
strip, or block.

## Incomplete deltas

`image-delta` and `audio-delta` values are not passed to media guardrails.
Incomplete encoded bytes may be undecodable, unrenderable, or misleading to a
classifier; treating them as complete assets would create false Safety.

When no enforcing output-media policy applies, deltas publish immediately.
Report-mode policies run against the completed canonical asset and record
their decisions without changing already published deltas.

When an enforcing output-media policy applies, deltas remain private in the
attempt-local release coordinator. After native completion:

1. the provider result is decoded and validated;
2. final canonical assets enter existing output-media traversal;
3. retained assets publish as final events; and
4. the successful logical stream publishes `finish`.

A block or required-part strip rejects the stream and exposes none of the held
bytes. Held byte arrays are reused when constructing the final asset and are
released on rejection or cancellation.

## Final retention and write-back

Final image handling reuses the completed image rules:

- policies visit provider-ordered images using stable original indexes;
- enforced strips immutably remove selected images;
- at least one final image must remain; and
- `image` is reset to the first retained asset.

Final speech handling reuses the completed speech rules. Audio is required, so
an enforced strip escalates to a block.

The final events share their retained asset objects with `completion`.
Provider-native `raw`, warnings, and metadata keep their existing completed
result identities and remain outside canonical Safety guarantees.

## Callback and audit provenance

Streaming media adds optional provenance without replacing the existing text
stream context:

```ts
ctx.stream?.media;
// {
//   phase: "preview" | "final",
//   outputIndex: number,
//   sequence?: number
// }
```

Existing `ctx.stream` fields remain source compatible. Completed operations
continue to omit `stream.media`.

`MediaPartOrigin` adds `streamImage` and `streamSpeech` output variants.
Preview origins retain provider output slot and preview sequence. Final origins
retain the original provider slot even when an earlier image is stripped.

Audit and decision summaries may record operation, phase, indexes, canonical
part type, policy, mode, action, reason, duration, and validated findings.
They never record media sources, bytes, base64, URLs, filenames, hashes, or
native events.

## Routing commitment

Only a canonical public event commits a route:

- a held delta does not commit;
- a stripped preview does not commit;
- an allowed or warned preview commits when published;
- a live delta commits when published; and
- a final event commits if nothing earlier was public.

A provider failure before commitment may retry or fall back. A provider
failure after commitment terminates the logical stream. A Safety block,
malformed guardrail result, or guardrail exception is a terminal policy
outcome and never retries through a different provider.

Rejected physical attempts contribute no events or final result facts to the
logical log. Their safe attempt spans remain observable.

## Raw events

Provider-native progressive events stay typed at the provider definition and
per-call mapper seam. They are not public stream events.

This is required because raw events can contain media before canonical
projection and Safety. A call-site boolean cannot account for enforcing global
policies, and a public raw branch could not retract content after a final
block. [#285](https://github.com/use-crux/crux/issues/285) must define an
explicitly unsafe surface, its interaction with global Safety, and retention
before exposing it.

## Required acceptance evidence

Focused tests must prove:

- image and speech input Safety run before provider normalization and I/O;
- preview allow, warn, strip, block, and report-mode behavior;
- exact preview callback and audit provenance without payloads;
- live deltas without enforcement and held deltas with enforcement;
- final image retention and required speech strip escalation;
- final event/completion asset identity;
- routing commitment after publication but not after hold or strip;
- identical error identity across replay surfaces and completion;
- global policies and per-call tuning behave like completed operations; and
- observability, Devtools, decisions, and quality evidence contain descriptors
  only.
