package indexhost

import (
	"context"
	"fmt"
)

// PrewarmProjectSemantic starts the dedicated semantic worker process before
// the semantic request is ready, allowing AST/source work to overlap startup.
func (w *Worker) PrewarmProjectSemantic(ctx context.Context) error {
	if w == nil || w.semanticWorker == nil {
		return fmt.Errorf("project semantic worker is not configured")
	}
	return w.semanticWorker.Prewarm(ctx)
}
