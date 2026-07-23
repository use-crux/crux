package readmodel

import (
	"context"
	"fmt"

	indexcompletion "github.com/use-crux/crux/packages/local/internal/projectindex/completion"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// CompletionPosition is a zero-based UTF-16 position in an unsaved document.
type CompletionPosition = staticprotocol.CompletionPosition

// CompletionRange is a half-open UTF-16 range in an unsaved document.
type CompletionRange = staticprotocol.CompletionRange

// CompletionItem is one compiler-owned eager completion recipe.
type CompletionItem = staticprotocol.CompletionItem

// CompletionTextEdit is one additional compiler-owned source edit.
type CompletionTextEdit = staticprotocol.CompletionTextEdit

// CompletionRequest is the bounded unsaved-document input accepted by an
// active read-model source.
type CompletionRequest struct {
	File            string
	DocumentVersion int
	LanguageID      string
	Text            string
	Position        CompletionPosition
	Limit           int
}

// CompletionResult retains the document version and Project Index generation
// used by its compiler query so the LSP can reject a late result.
type CompletionResult struct {
	DocumentVersion int
	Generation      uint64
	IsIncomplete    bool
	Items           []CompletionItem
}

// CompletionSource is the optional transient-query surface implemented by
// both OWN and ATTACHED read-model sources.
type CompletionSource interface {
	Completion(context.Context, CompletionRequest) (CompletionResult, error)
}

func completeOwn(
	ctx context.Context,
	compiler indexcompletion.Compiler,
	snapshot Snapshot,
	request CompletionRequest,
) (CompletionResult, error) {
	if compiler == nil || snapshot.Generation == nil {
		return CompletionResult{}, fmt.Errorf("own completion source is unavailable")
	}
	view := indexcompletion.View{ProjectRoot: snapshot.ProjectRoot, Definitions: snapshot.Definitions}
	view.Generation = *snapshot.Generation
	result, err := indexcompletion.New(compiler).Complete(ctx, view, indexcompletion.Request{
		File: request.File, DocumentVersion: request.DocumentVersion,
		LanguageID: request.LanguageID, Text: request.Text,
		Position: request.Position, Limit: request.Limit,
	})
	if err != nil {
		return CompletionResult{}, err
	}
	return CompletionResult{
		DocumentVersion: result.DocumentVersion,
		Generation:      result.Generation,
		IsIncomplete:    result.IsIncomplete,
		Items:           result.Items,
	}, nil
}
