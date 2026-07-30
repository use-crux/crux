package server

import (
	"context"
	"fmt"

	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
)

// Analyze serves one private ATTACHED PromptText query without publishing or
// retaining its open-document source.
func (h *WSHub) Analyze(
	ctx context.Context,
	request indexprompttext.Request,
) (indexprompttext.Result, error) {
	if h == nil || h.devtools == nil {
		return indexprompttext.Result{}, fmt.Errorf("PromptText service is unavailable")
	}
	return h.devtools.AnalyzeProjectPromptText(ctx, request)
}
