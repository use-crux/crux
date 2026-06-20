package nodeworker

import (
	"context"
	"encoding/json"
	"fmt"
)

// StreamCall sends one JSON-line request to a persistent worker and reads
// NDJSON events until onEvent reports completion.
func StreamCall(ctx context.Context, w *Worker, req any, onEvent func(json.RawMessage) (bool, error)) error {
	return StreamCallBatch(ctx, w, []any{req}, onEvent)
}

// StreamCallBatch sends multiple JSON-line request events to a persistent worker
// and reads NDJSON events until onEvent reports completion.
func StreamCallBatch(ctx context.Context, w *Worker, requests []any, onEvent func(json.RawMessage) (bool, error)) error {
	if w == nil {
		return fmt.Errorf("nodeworker: nil worker")
	}
	if onEvent == nil {
		return fmt.Errorf("nodeworker: nil stream event handler")
	}
	if len(requests) == 0 {
		return fmt.Errorf("nodeworker: empty request batch")
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	if err := ctx.Err(); err != nil {
		return err
	}
	if err := w.ensureSpawned(); err != nil {
		return err
	}

	for _, req := range requests {
		data, err := json.Marshal(req)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		data = append(data, '\n')
		if _, err := w.stdin.Write(data); err != nil {
			w.killLocked()
			return fmt.Errorf("write to worker: %w", err)
		}
	}

	for {
		resultCh := make(chan scanResult, 1)
		go func() {
			resultCh <- scanLine(w.stdout, w.config.maxResponseBytes)
		}()

		select {
		case <-ctx.Done():
			err := ctx.Err()
			w.killLocked()
			return err
		case result := <-resultCh:
			if result.err != nil {
				w.killLocked()
				return result.err
			}
			if workerErr := decodeWorkerError(w.script.Name, result.bytes); workerErr != nil {
				return workerErr
			}
			done, err := onEvent(json.RawMessage(result.bytes))
			if err != nil {
				w.killLocked()
				return err
			}
			if done {
				return nil
			}
		}
	}
}
