package readmodel

import (
	"context"
	"errors"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/api"
	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
)

// ErrPromptTextUnavailable identifies a fail-soft attached server that does
// not expose the private PromptText route.
var ErrPromptTextUnavailable = errors.New("PromptText unavailable")

// PromptText forwards one bounded transient query to the attached dev server.
// Remote failures affect only this query and never the attached publication.
func (t *AttachTransport) PromptText(
	ctx context.Context,
	request PromptTextRequest,
) (PromptTextResult, error) {
	if t == nil || t.http == nil {
		return PromptTextResult{}, fmt.Errorf("attach transport is not configured")
	}
	var result indexprompttext.Result
	err := t.http.PostJSON(ctx, "/api/project/index/prompt-text", request, &result)
	if errors.Is(err, api.ErrNotFound) {
		return PromptTextResult{}, ErrPromptTextUnavailable
	}
	return result, err
}
