# Connected Knowledge Portability, Communities, and Eval Lifecycle

## Objective

Make model-backed assertion extraction portable across Crux's supported structured-output providers, make assertions first-class inputs to community construction and reporting, and guarantee that an Eval task owning an in-memory Knowledge Base reaches a terminal state.

The implementation must preserve Crux's canonical typed assertion API. Provider-specific wire compromises stay internal.

## Constraints

- `@use-crux/core` remains provider-agnostic.
- Model-backed extraction normally uses one generation call per bounded chunk batch.
- Provider-facing schemas avoid cross-kind unions, optional fields, arbitrary object schemas, and content-dependent structure.
- All generated object properties are required and closed with `additionalProperties: false`.
- String enums remain provider-enforced. Lowercase machine values avoid Anthropic's documented human-readable enum casing edge case.
- Original authored Zod schemas remain the final local validation authority.
- ECO's flat schemas remain unchanged until native behavior is proven at least as reliable on its provider matrix.
- Community weighting is internal and versioned while the API is pre-stable; no public tuning surface is introduced yet.

## 1. Portable Assertion Wire Compiler

### Grouped output

Compile every model-backed assertion stage into one root object containing one required array per authored assertion type. Stable slots (`type_0`, `type_1`, and so on) are assigned by deterministic authored-type ordering. Slot names never depend on user-authored identifiers.

Each slot maps back to one assertion type through an internal decode manifest. The canonical `type` discriminator is restored after generation.

```json
{
  "type_0": [
    {
      "data": { "statement": "...", "priority": "must" },
      "evidence": [{ "sourceId": "doc", "chunkId": "chunk-1" }],
      "provenance": "derived"
    }
  ],
  "type_1": []
}
```

This removes the union between assertion kinds without repeating the prompt in one call per kind. A missing kind is represented by its required empty array.

### Portable schema profile

Each authored data schema is analyzed recursively. The typed wire profile permits:

- closed objects whose properties are all required;
- homogeneous arrays;
- strings, numbers, integers, and booleans;
- string and numeric enums;
- bounded nesting and schema size;
- descriptions.

The profile does not send provider-enforced optional fields, nullable/type unions, `oneOf`, `anyOf`, `allOf`, arbitrary-key records, transforms, refinements, or provider-inconsistent validation keywords. Constraints that can be represented safely remain in the wire schema. Other constraints remain in descriptions and are always enforced by local validation.

### Selective fallback

A type outside the portable profile uses a serialized payload only for that slot:

```json
{
  "type_1": [
    {
      "dataJson": "{\"complex\":\"payload\"}",
      "evidence": [{ "sourceId": "doc", "chunkId": "chunk-1" }],
      "provenance": "exact"
    }
  ]
}
```

The manifest records `typed` or `json-string` per slot. Serialized data is parsed and checked against the original schema locally. A diagnostic identifies fallback types and why they could not use typed structured output.

### Descriptions and prompt guidance

Descriptions are part of compilation:

- each slot describes its authored assertion type and says to return `[]` when absent;
- typed `data` retains the authored schema's `.describe()` text;
- generated fallback descriptions summarize the expected JSON shape without placing an unsupported schema in the provider contract;
- evidence fields explain that IDs must come from prompt-listed target chunks;
- provenance describes the exact-versus-derived distinction;
- enum descriptions retain authored guidance.

The system and user prompt explicitly state:

- what each slot represents;
- that every slot must be present;
- when to emit an empty array;
- that the same assertion must not be duplicated across slots or batches;
- how to cite evidence and honor target-only chunks;
- how to choose provenance;
- how to encode a `dataJson` fallback value;
- that output must contain only claims supported by supplied evidence.

### Decode, validation, and repair

Decode all slots through the manifest, restore canonical type discriminators, and validate:

1. slot and assertion-type identity;
2. typed or parsed data against the original authored Zod schema;
3. evidence against visible and target-admissible chunks;
4. provenance against the canonical enum;
5. canonical assertion identity and deduplication.

Valid first-attempt assertions are retained. Repair prompts identify invalid slots and exact local validation failures. Repairs use the same stable schema and should replace only invalid material rather than discard valid claims.

### Cache and compatibility

The wire manifest and portable compiler version contribute to the stage fingerprint. The schema is independent of chunk contents so provider grammar caches can be reused. Compatibility tests recursively reject forbidden schema constructs and snapshots verify stable slot assignment.

## 2. Assertion-Aware Communities

### Heterogeneous community projection

Community construction projects:

- chunks;
- entities and entity relations;
- assertions;
- assertion evidence links to chunks;
- assertion-to-entity affinities derived from visible evidence;
- explicit assertion relations such as support, contradiction, qualification, and supersession.

Assertions are not treated as unweighted duplicates of their supporting chunks. A versioned internal policy assigns weights by evidence and relation role.

### Membership and affinity

Every visible assertion receives a deterministic primary leaf community from its strongest visible support. It may receive secondary memberships when distinct evidence supports span communities.

Primary membership affects clustering weight and canonical membership identity. Secondary membership makes relevant assertions available to reports without multiplying their clustering influence.

Explicit assertion relations strengthen affinity between their endpoint communities. Strong semantic relations may influence parent grouping; a shared source document alone does not force a merge. Assertion volume is normalized so a prolific extraction stage cannot dominate chunks and entities merely by producing more records.

### Views

A view includes an assertion only when at least one admissible support is visible. Primary membership is recomputed within the view's visible projection. Relations are internal when both endpoints are visible and boundary relations when only the remote community differs; relations with an invisible endpoint are not exposed as complete internal evidence.

### Reports

Leaf report generation receives member chunks, entities, assertions, internal assertion relations, and bounded cross-community relation summaries. Prompt guidance distinguishes canonical assertions from raw source text and requires findings to cite available evidence and assertion IDs.

Counts are deterministic identity counts:

- unique entities represented by the report;
- unique chunks represented by the report;
- unique assertions represented by primary or secondary membership.

Parent reports aggregate descendant identity sets rather than summing child counts, preventing double counting. Findings may carry validated assertion references only when those assertions exist in the report projection.

### Identity and reuse

Community member hashes and lineage include the assertion projection, assertion relations, membership-policy version, and report-prompt version. Any change that can alter community output invalidates reusable reports. Existing community identities remain deterministic from normalized canonical members, but breaking identity changes are acceptable pre-stable when the semantic membership changes.

## 3. Eval-Owned Knowledge Base Lifecycle

Add an integration regression whose Eval task:

1. creates in-memory storage and a Knowledge Base;
2. indexes chunks and assertions;
3. creates relations and communities;
4. reads assertions, reports, and inspection state;
5. disposes explicitly owned resources where the public contract requires it;
6. reaches terminal task, cell, coordinator, and saved-run events;
7. leaves no retained work, timers, captured signals, or effect scopes that keep execution active.

Run the regression first against current behavior. If it reproduces the hang, trace captured resources and fix the owning lifecycle boundary. Do not add arbitrary timeouts or special-case Knowledge Base calls. Both success and failure paths must settle and release resources. If the exact report cannot be reproduced, retain the regression as coverage and document the observed terminal behavior rather than claiming a speculative fix.

## 4. Testing and Release

Focused tests cover:

- no forbidden union, optional, or unconstrained schema constructs;
- typed grouped extraction for multiple assertion kinds in one call;
- enum and description preservation;
- stable slots and manifests;
- selective JSON fallback and diagnostics;
- local validation and slot-scoped repair;
- evidence targeting and deduplication;
- assertion primary/secondary community membership;
- weighted relations, hierarchy effects, and volume normalization;
- view filtering and boundary relations;
- deduplicated leaf and parent counts;
- assertion-aware prompts, finding references, and cache invalidation;
- complete Eval terminal lifecycle.

When credentials are available, live smoke tests should cover native OpenAI, Anthropic, and Gemini plus OpenRouter Luna and Anthropic-backed endpoints. Static profile tests prove schema construction but do not claim that a changing third-party endpoint is permanently compatible.

Update the existing assertion and Connected Knowledge changesets rather than create duplicates. The change affects published `@use-crux/core` runtime behavior and documentation.

