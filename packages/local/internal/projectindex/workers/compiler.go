package workers

import (
	"context"
	"fmt"

	staticcompiler "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compiler"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

type StaticCompiler = staticcompiler.Static

// Completion routes a transient query to the same persistent native compiler
// pool used by Static Indexing. It never starts a second compiler session.
func (w *Bundle) Completion(ctx context.Context, query staticprotocol.CompletionQuery) (staticprotocol.CompletionResponse, error) {
	if w == nil {
		return staticprotocol.CompletionResponse{}, fmt.Errorf("project completion compiler is not configured")
	}
	compiler, ok := w.syntaxParser.(staticcompiler.Completer)
	if !ok {
		return staticprotocol.CompletionResponse{}, fmt.Errorf("project completion compiler is unavailable")
	}
	return compiler.Completion(ctx, query)
}

// PromptText routes transient analysis to the same persistent native compiler
// pool used by Static Indexing.
func (w *Bundle) PromptText(
	ctx context.Context,
	query staticprotocol.PromptTextQuery,
) (staticprotocol.PromptTextQueryResponse, error) {
	if w == nil {
		return staticprotocol.PromptTextQueryResponse{}, fmt.Errorf("PromptText compiler is not configured")
	}
	compiler, ok := w.syntaxParser.(staticcompiler.PromptTextAnalyzer)
	if !ok {
		return staticprotocol.PromptTextQueryResponse{}, fmt.Errorf("PromptText compiler is unavailable")
	}
	return compiler.PromptText(ctx, query)
}

var _ staticcompiler.Completer = (*Bundle)(nil)
var _ staticcompiler.PromptTextAnalyzer = (*Bundle)(nil)
