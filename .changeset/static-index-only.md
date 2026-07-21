---
"@use-crux/core": major
"@use-crux/indexer": major
"@use-crux/local": major
---
Make Rust/Oxc the required Static Index path, remove the obsolete
`experimental.indexer.nativeAst` option and TypeScript static-plan worker
artifact, and advance Project Index worker events to protocol v3. Configured
third-party static extractors continue to run through the trusted JavaScript
host.
