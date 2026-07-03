package devtools

import (
	"context"
	"encoding/json"
)

// RunRuntimeOperation executes one Runtime Engine read or mutation for local
// devtools and CLI-style operator views.
func (s *Service) RunRuntimeOperation(ctx context.Context, root, operation, workID string, includeDetails bool) (json.RawMessage, error) {
	return s.indexService.RunRuntimeOperation(ctx, root, operation, workID, includeDetails)
}
