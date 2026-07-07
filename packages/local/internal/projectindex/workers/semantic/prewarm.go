package semantic

import (
	"context"
	"fmt"
)

// Prewarm starts the semantic worker process without running semantic
// enrichment. Reindex orchestration uses this to overlap Node startup with
// native AST work.
func (w *Worker) Prewarm(ctx context.Context) error {
	if w == nil || len(w.phases) == 0 || w.phases[0].Worker == nil {
		return fmt.Errorf("project semantic worker is not configured")
	}
	return w.phases[0].Worker.Prewarm(ctx)
}
