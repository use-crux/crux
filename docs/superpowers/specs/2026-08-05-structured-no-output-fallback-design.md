# Structured no-output fallback

## Goal

Treat AI SDK `NoOutputGeneratedError` as a failed structured-output attempt so Crux routing can fall back under the existing `invalid_response` policy.

## Design

- Recognize the AI SDK's stable `AI_NoOutputGeneratedError` identity in the AI adapter without importing AI SDK error classes into Core.
- Normalize it at the AI adapter boundary to a provider-neutral `CruxAdapterError` with kind `invalid-response` and a content-free machine code.
- Map `invalid-response` to Core's existing `invalid_response` routing category. This remains distinct from `ValidationExhaustedError`, which is deliberately policy-terminal after repair is exhausted.
- Preserve policy-terminal behavior and do not retain provider output, raw structured text, or sensitive error payloads.
- Keep Core independent of the AI SDK; Core only owns the provider-neutral adapter error kind.

## Verification

- Direct standalone structured generation falls back after no output.
- Both attempts appear when all fallback candidates produce no output.
- The routing receipt classifies the failed attempt as `invalid_response` and records the successful secondary model.
- Existing structured repair and policy-terminal tests remain green.
- A Connected Knowledge assertion/community integration path exercises the same standalone helper.
