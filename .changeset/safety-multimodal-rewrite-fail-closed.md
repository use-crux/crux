---
"@use-crux/core": minor
"@use-crux/ai": minor
"@use-crux/indexer": patch
---

Safety input guardrail rewrites now fail closed on multimodal messages: a rewrite that cannot be
faithfully re-applied to the message's text parts (mutated or spoofed media placeholders,
media-only messages) throws `SafetyResultError` instead of being silently dropped or duplicating
placeholder text into the prompt. `boundary.output.both()` guards now receive the parsed object
alongside the output text.

Add `boundary.input.media()` for inspecting canonical non-text input parts before provider
normalization with fully inferred callback types and stable original indexes. Enforced `strip`
decisions remove only the current part, while report-mode strips record intent without changing
provider input; Project Index now records the exact media boundary on authored guardrails. Input
media remains guardrail-only: constraints reject `boundary.input.media()` in TypeScript and fail
closed on bypassed configurations.

Add `guardrail.media()` as a declarative, provider-neutral attachment policy for MIME allowlists,
byte limits, exact remote hosts, inline/provider-file categories, and URL userinfo/query posture.
It inspects only caller-supplied metadata and local bytes, supports block or strip enforcement, and
keeps locator and payload details out of decisions. Project Index now records complete literal
guardrail helper strategy config through the bundled native Safety extractor and retains kind-only
facts for dynamic config.

Add `boundary.output.media()` and completed image Safety. Generated images now run output policies
once after routing selects a result; enforce-mode strips preserve image order, reset the `image`
alias, and block on the final image, while report mode preserves the result. Direct image-edit
references and masks run input media policies before provider normalization with immutable
write-back and a fail-closed retained-mask dependency. Canonical write-back preserves provider
`raw` and metadata identities.

Add completed speech Safety options and runtime coverage. Speech `text` and optional
`instructions` now run through their exact input boundaries before provider normalization, and
generated audio runs output-media policies before reporting or return. Enforced audio strip blocks
because audio is required; report mode preserves it. Canonical audit write-back retains provider
facts and works identically through direct bindings and provider runtimes.

Add completed transcription Safety options and runtime enforcement. Prompt hints and required
audio are guarded before normalization or materialization, while validated transcript text is
guarded once before reporting or return. Enforced transcript rewrites clear timed segments and
words without changing provider-native facts. Transcript constraints run exactly once with no
provider retry: assert failures throw and suggest/report failures remain in canonical audit.

Completed operations now validate every exact Safety binding against their primitive before
provider work. Inapplicable call and prompt bindings fail closed, while global tuple members remain
auditable as dormant without suppressing applicable members; duplicate IDs and invalid media tuning
still fail before dormancy classification.

Typed image prompts now merge prompt guardrails with global and call policies, guard resolved user
and system text at their exact boundaries, and hand providers a direct prepared prompt without a
second resolution. Routed prompts require one candidate-stable ordered policy set, lazily guard only
attempted candidates, and treat candidate input Safety failures as terminal rather than eligible for
fallback.

Language generation now guards every provider-produced step before client tools, history append,
observation, continuation, or public accumulation. The loop-runtime contract exposes an optional
pre-client-tool transform capability with Core-owned indexed text/media edits; incapable runtimes
fail before provider I/O when step policies apply. Core and AI SDK dialects preserve tool calls,
raw/provider identities, and guarded step/envelope consistency across reasoning, media, structured
validation, and constraint regeneration.

Stream completion now guards buffered reasoning and media through one shared Core gate before
completion resolves in both adapter dialects. Live text retains its existing staged stream Safety
and is not re-guarded at completion; completion-only text is guarded once, stripped media is
removed consistently from content and assistant messages, and buffered blocks may reject after
already emitted safe text. Raw provider and SDK stream handles remain unchanged and explicitly
unguarded.
