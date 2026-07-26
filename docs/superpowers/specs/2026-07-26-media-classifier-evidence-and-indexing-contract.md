# Media classifier evidence and indexing contract

Status: **approved companion to the
[media classifier design](./2026-07-26-media-classifier-guardrail-design.md)**

## Findings and audit

`SafetyFinding` gains narrowly defined classifier evidence:

```ts
export interface SafetyFinding {
  readonly type: string
  readonly count?: number
  readonly span?: {
    readonly start: number
    readonly end: number
  }
  readonly category?: string
  readonly score?: number
  readonly threshold?: number
}
```

A threshold match produces:

```ts
{
  type: 'media_classifier_match',
  category: 'graphic-violence',
  score: 0.91,
  threshold: 0.9,
}
```

An explicitly handled capability gap produces:

```ts
{
  type: 'media_not_inspected',
}
```

It never has a category or score because no classification occurred.

Guardrail runners create a real per-invocation collector, validate and freeze
added findings, and merge them with rewrite-result findings in stable order.
Malformed findings fail closed with the existing `SafetyResultError`.
Findings flow into:

- `GuardrailAuditEntry.findings`;
- canonical `SafetyDecision.findings`;
- the privacy-safe `guardrail.report` artifact;
- Devtools projections; and
- evaluation output for compatible boundaries.

This shared repair also makes existing text-classifier
`ctx.findings.add()` calls observable instead of silently discarding them.

Detailed category IDs and scores belong in audit artifacts, not
high-cardinality OTel attributes. Events and spans carry bounded counts such
as `findingCount` and `matchedCategoryCount`.

No media source, bytes, URL, provider file ID, provider options, category
description, or generated explanation enters telemetry. Explicit
`unsupported: 'allow'` still records `media_not_inspected`, even though an
ordinary allow result has no reason.

## Runtime strategy metadata

Runtime metadata is frozen and JSON-safe:

```ts
{
  kind: 'guardrail.mediaClassifier',
  config: {
    categoryIds: ['sexual-content', 'graphic-violence'],
    threshold: 0.8,
    thresholds: {
      'graphic-violence': 0.9,
    },
    action: 'block',
    modalities: ['image', 'audio', 'video', 'file'],
    unsupported: 'throw',
    promptVersion: '1',
  },
}
```

It excludes executable `generate`, opaque `model`, full descriptions, and all
runtime media.

## Project Index

Project Index records the authored helper kind as `mediaClassifier`. Literal,
safe policy fields may be projected when statically known. Executable
expressions, model objects, generator references, and full descriptions are
never indexed as strategy config.

Dynamic options preserve the helper kind and omit unavailable config, matching
existing strategy extraction behavior. Static extraction must retain Rust/Oxc
and fallback parity. If implementation also changes semantic enrichment, the
JavaScript TypeScript and native semantic backends must retain exact parity.

The implementation must audit cache identity:

- update the extension/extractor identity when that structured identity already
  participates in cache keys; or
- bump `STATIC_PARSE_CACHE_EPOCH` if unchanged source could otherwise retain
  stale strategy output.

No semantic or Go snapshot epoch changes are needed unless their owned output
or cache semantics actually change.

## Privacy invariants

- The classifier sees the current canonical media part only.
- `providerOptions` from the protected call are removed.
- Category descriptions remain authored configuration and do not enter generic
  runtime strategy metadata.
- Free-form classifier explanations are neither requested nor retained.
- Reasons are built from category IDs and validated numbers.
- Unsupported reasons use only fields already guaranteed safe by
  `UnsupportedCapabilityError`.
- OTel carries counts, not unbounded categories or rubric text.
- Report mode changes enforcement, never capture policy.
