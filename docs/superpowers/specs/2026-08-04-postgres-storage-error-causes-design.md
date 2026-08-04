# PostgreSQL storage error causes

## Goal

Preserve the original PostgreSQL driver error when a storage operation fails, so callers and observability tooling can diagnose failures such as missing columns without weakening Crux's stable error contract.

## Design

`backendError(operation, cause)` continues to throw a `StorageError` with code `backend_error` and the existing operation-scoped, payload-free message. It passes the caught value through `StorageError`'s existing `{ cause }` option. No driver message, query text, parameters, or credentials are copied into the public message.

This single helper covers record and search storage operations. Transaction rollback behavior and validation errors remain unchanged.

## Verification

Add a focused unit test for `backendError` proving that:

- the error code and safe message remain unchanged;
- the exact original error object is available as `error.cause`;
- non-`Error` thrown values are also preserved without coercion.

Run the PostgreSQL package tests and typecheck.
