package readmodel

import (
	"context"
	"errors"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/api"
	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
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
	err := t.http.PostJSONStrict(ctx, "/api/project/index/prompt-text", request, &result)
	if errors.Is(err, api.ErrNotFound) {
		return PromptTextResult{}, ErrPromptTextUnavailable
	}
	if err == nil {
		err = indexprompttext.ValidateResult(result)
	}
	if err == nil && result.ProtocolVersion !=
		staticprotocol.PromptTextProtocolVersion {
		err = fmt.Errorf(
			"PromptText protocol version %d does not match %d",
			result.ProtocolVersion,
			staticprotocol.PromptTextProtocolVersion,
		)
	}
	if err == nil && result.File != request.File {
		err = fmt.Errorf("PromptText response file %q does not match %q", result.File, request.File)
	}
	if err == nil && result.Revision != request.Revision {
		err = fmt.Errorf("PromptText response revision does not match request")
	}
	return result, err
}
