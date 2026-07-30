package readmodel

import indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"

// PromptTextRequest is one exact, cache-bypassing open-document analysis
// request accepted by either OWN or ATTACHED mode.
type PromptTextRequest = indexprompttext.Request

// PromptTextResult is normalized, AST-free evidence for the exact revision
// echoed by the compiler.
type PromptTextResult = indexprompttext.Result
