# PostgreSQL storage error causes implementation plan

1. Add focused failing coverage for `backendError`'s stable message, code, and cause identity.
2. Pass `cause` to the existing `StorageError` constructor and remove the discard.
3. Run `@use-crux/postgres` tests, typecheck, and `git diff --check`.
4. Update an existing relevant storage changeset when available; otherwise add one patch changeset for `@use-crux/postgres`.
