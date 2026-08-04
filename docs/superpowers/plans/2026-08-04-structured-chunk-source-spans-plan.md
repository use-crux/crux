# Exact structured chunk source spans plan

1. Add focused failing tests for whitespace, overlap, ambiguity, and table windows.
2. Make the text splitter retain boundaries and slice original content.
3. Resolve part-relative spans only through an unambiguous aggregate-content mapping.
4. Remove false exact table-window spans and preserve coarse provenance.
5. Run focused indexing tests, the core package tests/typecheck, and `git diff --check`.
6. Add or update one relevant `@use-crux/core` patch changeset.
