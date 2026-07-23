package server

import (
	"context"
	"fmt"

	indexcompletion "github.com/use-crux/crux/packages/local/internal/projectindex/completion"
)

// Complete pins one coherent hub snapshot, then releases the hub lock before
// running the transient compiler query. A later index generation is rejected
// by the LSP caller rather than blocking publication here.
func (h *WSHub) Complete(ctx context.Context, request indexcompletion.Request) (indexcompletion.Result, error) {
	h.indexMu.Lock()
	snapshot, err := h.projectIndexLocked()
	h.indexMu.Unlock()
	if err != nil {
		return indexcompletion.Result{}, err
	}
	if h.devtools == nil {
		return indexcompletion.Result{}, fmt.Errorf("project completion service is unavailable")
	}
	return h.devtools.CompleteProjectIndex(ctx, indexcompletion.View{
		ProjectRoot: snapshot.ProjectRoot,
		Generation:  snapshot.Generation,
		Definitions: snapshot.Definitions,
	}, request)
}
