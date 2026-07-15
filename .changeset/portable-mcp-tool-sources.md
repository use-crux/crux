---
"@use-crux/core": minor
"@use-crux/mcp": minor
"@use-crux/ai": minor
"@use-crux/openai": minor
"@use-crux/anthropic": minor
"@use-crux/google": minor
"@use-crux/indexer": minor
"@use-crux/local": minor
"@use-crux/devtools": minor
"@use-crux/otel": minor
---

Add portable MCP tool sources over Streamable HTTP and stdio. MCP tools now
materialize lazily across every first-party generation adapter and retain the
ordinary Crux middleware, Safety, approval replay, Quality, observability, and
cleanup contracts.

Project Index and Devtools now connect authored MCP servers with
runtime-discovered tools, safe schemas and fingerprints, health and lifecycle state,
Run Detail preparation evidence, and exact Catalog activity. The new
`@use-crux/mcp` package owns both supported client paths and keeps MCP optional
for Core and adapter installations.
