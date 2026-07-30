// Package prompttext owns cache-bypassing PromptText compiler queries.
//
// Requests may contain unsaved source. They are bounded, cancellable, and
// memory-only; they must never enter Project Index stores, patches, or logs.
package prompttext

import (
	"context"

	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// Revision identifies the exact open-document bytes being analyzed.
type Revision = staticprotocol.PromptTextDocumentRevision

// Fragment is one bounded, semantically proven static-analysis input.
type Fragment = staticprotocol.PromptTextFragment

// FragmentJoin is one semantic-exact interpolation-to-fragment edge.
type FragmentJoin = staticprotocol.PromptTextFragmentJoin

// CompilerQuery is the internal persistent-worker request.
type CompilerQuery = staticprotocol.PromptTextQuery

// CompilerResponse is the normalized AST-free worker result.
type CompilerResponse = staticprotocol.PromptTextQueryResponse

// Result is the exact-revision normalized analysis returned to a caller.
type Result = staticprotocol.PromptTextQueryResponse

// Request supplies one exact open-document snapshot to Analyze.
type Request struct {
	File          string         `json:"file"`
	LanguageID    string         `json:"languageId"`
	Revision      Revision       `json:"revision"`
	Text          string         `json:"text"`
	Fragments     []Fragment     `json:"fragments"`
	FragmentJoins []FragmentJoin `json:"fragmentJoins"`
}

// Analyzer serves one cancellable transient PromptText query.
type Analyzer interface {
	Analyze(context.Context, Request) (Result, error)
}

// Compiler is the minimal persistent-worker capability used by Service.
type Compiler interface {
	PromptText(context.Context, CompilerQuery) (CompilerResponse, error)
}
