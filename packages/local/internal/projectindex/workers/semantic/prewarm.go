package semantic

import (
	"context"
	"fmt"
)

// Prewarm starts the semantic worker process without running semantic
// enrichment. Reindex orchestration uses this to overlap Node startup with
// native AST work.
func (w *Worker) Prewarm(ctx context.Context) error {
	if w == nil || w.phase.Worker == nil {
		return fmt.Errorf("project semantic worker is not configured")
	}
	return w.phase.Worker.Prewarm(ctx)
}
