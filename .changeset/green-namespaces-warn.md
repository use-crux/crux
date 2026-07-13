---
'@use-crux/core': minor
'@use-crux/indexer': minor
'@use-crux/local': minor
---

`serverless()` now infers distinct Vercel production and preview Runtime Engine namespaces and records their provenance. Production serverless configurations without an explicit namespace, `CRUX_RUNTIME_NAMESPACE`, or supported Vercel signal now throw `NAMESPACE_AMBIGUOUS` at composition instead of silently using `local`; set `CRUX_RUNTIME_NAMESPACE=production` or pass `serverless({ namespace: "..." })`.

Runtime setup and preflight now warn when a serverless definition legitimately falls back to `local` in development, and the `crux` CLI renders passing-setup warnings in `crux runtime generate` and `crux dev` preflight output.
