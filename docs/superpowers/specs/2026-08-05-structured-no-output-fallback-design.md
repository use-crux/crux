# Structured no-output fallback

## Goal

Treat AI SDK `NoOutputGeneratedError` as a failed structured-output attempt so Crux routing can fall back under the existing `invalid_response` policy.

## Design

- Recognize the AI SDK's stable `AI_NoOutputGeneratedError` identity in the AI adapter without importing AI SDK error classes into Core.
- Convert it to the existing `StructuredAttempt` invalid result with a content-free validation issue. Normal Prompt execution then uses Core's existing validation-exhaustion behavior.
- In the standalone `generateObjectFn()` bridge used by Connected Knowledge, convert an invalid attempt into a provider-neutral `ValidationExhaustedError`. Core already classifies that error as `invalid_response`.
- Preserve policy-terminal behavior and do not retain provider output, raw structured text, or sensitive error payloads.
- Do not add a new public error category or make Core depend on the AI SDK.

## Verification

- Direct standalone structured generation falls back after no output.
- Both attempts appear when all fallback candidates produce no output.
- The routing receipt classifies the failed attempt as `invalid_response` and records the successful secondary model.
- Existing structured repair and policy-terminal tests remain green.
- A Connected Knowledge assertion/community integration path exercises the same standalone helper.
