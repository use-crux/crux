package readmodel

import (
	"context"
	"errors"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/api"
	indexcompletion "github.com/use-crux/crux/packages/local/internal/projectindex/completion"
)

// ErrCompletionUnavailable identifies a compatible fail-soft absence, such as
// an attached server that does not expose the private completion route.
var ErrCompletionUnavailable = errors.New("completion unavailable")

// Completion forwards one bounded transient query to the attached dev server.
// Route absence and other remote failures are returned only to the completion
// caller; they do not affect the attached Project Index stream.
func (t *AttachTransport) Completion(ctx context.Context, request CompletionRequest) (CompletionResult, error) {
	if t == nil || t.http == nil {
		return CompletionResult{}, fmt.Errorf("attach transport is not configured")
	}
	var result indexcompletion.Result
	err := t.http.PostJSON(ctx, "/api/project/index/completions", indexcompletion.Request{
		File: request.File, DocumentVersion: request.DocumentVersion,
		LanguageID: request.LanguageID, Text: request.Text,
		Position: request.Position, Limit: request.Limit,
	}, &result)
	if err != nil {
		if errors.Is(err, api.ErrNotFound) {
			return CompletionResult{}, ErrCompletionUnavailable
		}
		return CompletionResult{}, err
	}
	return CompletionResult{
		DocumentVersion: result.DocumentVersion,
		Generation:      result.Generation,
		IsIncomplete:    result.IsIncomplete,
		Items:           result.Items,
	}, nil
}

var _ TransientSource = (*AttachTransport)(nil)
