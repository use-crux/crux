// Package completion owns transient Project Index completion contracts.
//
// Requests may contain unsaved source and therefore must never be persisted,
// logged, or included in Project Index snapshot/delta payloads.
package completion

import (
	"context"

	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// Position is a zero-based UTF-16 position in the transient document.
type Position = staticprotocol.CompletionPosition

// Range is a half-open UTF-16 range in the transient document.
type Range = staticprotocol.CompletionRange

// CompilerQuery is the internal cache-bypassing Static Index query.
type CompilerQuery = staticprotocol.CompletionQuery

// CompilerResponse is the eager result returned by the Static Index compiler.
type CompilerResponse = staticprotocol.CompletionResponse

// Item is one compiler-owned eager completion recipe.
type Item = staticprotocol.CompletionItem

const (
	// MaxItems is the compiler and transport result cap.
	MaxItems = 100
	// MaxDocumentBytes bounds one unsaved source document.
	MaxDocumentBytes = 2 << 20
	// MaxRequestBytes bounds the JSON envelope around a 2 MiB source document.
	MaxRequestBytes = MaxDocumentBytes + (64 << 10)
)

// Request is one transient query against an unsaved document version.
type Request struct {
	File            string                            `json:"file"`
	DocumentVersion int                               `json:"documentVersion"`
	LanguageID      string                            `json:"languageId"`
	Text            string                            `json:"text"`
	Position        staticprotocol.CompletionPosition `json:"position"`
	Limit           int                               `json:"limit"`
}

// Result identifies both the unsaved document and coherent index generation
// used to compute eager completion items.
type Result struct {
	DocumentVersion int                             `json:"documentVersion"`
	Generation      uint64                          `json:"generation"`
	IsIncomplete    bool                            `json:"isIncomplete"`
	Items           []staticprotocol.CompletionItem `json:"items"`
}

// Provider serves completion from one coherent Project Index view.
type Provider interface {
	Complete(context.Context, Request) (Result, error)
}

// Compiler is the minimal persistent Static Index worker capability reused by
// the transient service. The service does not own or start its implementation.
type Compiler interface {
	Completion(context.Context, CompilerQuery) (CompilerResponse, error)
}
