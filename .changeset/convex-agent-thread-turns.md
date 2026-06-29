---
'@use-crux/convex': major
---

Complete the profile-backed `convexAgent()` lifecycle around the Convex Agent method surface.

- Align thread continuation with Convex Agent: call `continueThread(ctx, target)` first, then pass Crux prompt `input` to `thread.generateText()`, `thread.streamText()`, `thread.generateObject()`, or `thread.streamObject()`.
- Add profile-backed `generateObject()` and `streamObject()` support, injecting resolved Crux prompt state and prompt output schemas through the same lifecycle/driver boundary as text generation.
- Derive public generation args/options/results from upstream Convex Agent method types while omitting Crux-owned `system`, `prompt`, `messages`, and `tools`.
- Add the `crux` config namespace for Crux-owned lifecycle controls: `crux.prepare`, `crux.runtime.store`, `crux.runtime.namespace`, `crux.observe`, `crux.persistence`, and advanced `crux.driver`. Existing top-level `prepare`, `store`, and `namespace` remain as deprecated compatibility aliases.
- Move Crux-only prompt resolution to `agent.crux.resolve()` with direct `agent.resolve()` kept as a deprecated compatibility alias.
