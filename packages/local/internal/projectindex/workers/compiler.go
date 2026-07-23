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

var _ staticcompiler.Completer = (*Bundle)(nil)
