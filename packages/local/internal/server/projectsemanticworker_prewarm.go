package server

import (
	"context"
	"fmt"
)

// Prewarm starts the semantic worker process without running semantic
// enrichment. Reindex orchestration uses this to overlap Node startup with
// native AST work.
func (w *ProjectSemanticWorker) Prewarm(ctx context.Context) error {
	if w == nil || w.worker == nil {
		return fmt.Errorf("project semantic worker is not configured")
	}
	return w.worker.Prewarm(ctx)
}
