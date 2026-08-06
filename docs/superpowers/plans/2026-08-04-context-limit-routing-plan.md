# Context-limit routing plan

1. Add failing classification and routing tests for `REQUEST_TOO_LARGE`.
2. Add the `input_limit` category and bounded cause-chain recognition.
3. Enable fallback and opt-in cascade escalation; exclude it from same-model retry defaults.
4. Update routing documentation and type coverage.
5. Run focused routing tests, core tests/typecheck, docs checks where applicable, and `git diff --check`.
6. Add or update one relevant `@use-crux/core` patch changeset.
