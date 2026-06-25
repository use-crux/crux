package node

import (
	"context"
	"fmt"
)

// Prewarm starts the persistent worker process without sending a request.
// The next Call or StreamCallBatch reuses the same process and pays only the
// request/response work.
func (w *Worker) Prewarm(ctx context.Context) error {
	if w == nil {
		return fmt.Errorf("node process: nil worker")
	}
	w.mu.Lock()
	defer w.mu.Unlock()

	if err := ctx.Err(); err != nil {
		return err
	}
	return w.ensureSpawned()
}
