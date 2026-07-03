package service

import (
	"context"
	"encoding/json"
	"fmt"
)

// RunRuntimeOperation executes a Runtime Engine operator/devtools operation
// through the configured TypeScript worker.
func (s *Service) RunRuntimeOperation(ctx context.Context, root, operation, workID string, includeDetails bool) (json.RawMessage, error) {
	if s == nil || s.indexer == nil {
		return nil, fmt.Errorf("project index indexer is not configured")
	}
	indexer, ok := s.indexer.(RuntimeOperationClient)
	if !ok {
		return nil, fmt.Errorf("project index indexer does not support runtime operations")
	}
	return indexer.RunRuntimeOperation(ctx, root, operation, workID, includeDetails)
}
