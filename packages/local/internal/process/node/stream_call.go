package node

import (
	"context"
	"encoding/json"
	"fmt"
)

// StreamSender writes one JSON-line request into an active persistent-worker
// stream session.
type StreamSender func(req any) error

// RawJSONLine is a pre-encoded JSON request line for high-volume internal
// transports that already own valid JSON bytes.
type RawJSONLine []byte

// StreamCall sends one JSON-line request to a persistent worker and reads
// NDJSON events until onEvent reports completion.
func StreamCall(ctx context.Context, w *Worker, req any, onEvent func(json.RawMessage) (bool, error)) error {
	return StreamCallBatch(ctx, w, []any{req}, onEvent)
}

// StreamCallBatch sends multiple JSON-line request events to a persistent worker
// and reads NDJSON events until onEvent reports completion.
func StreamCallBatch(ctx context.Context, w *Worker, requests []any, onEvent func(json.RawMessage) (bool, error)) error {
	if w == nil {
		return fmt.Errorf("node process: nil worker")
	}
	if onEvent == nil {
		return fmt.Errorf("node process: nil stream event handler")
	}
	if len(requests) == 0 {
		return fmt.Errorf("node process: empty request batch")
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

// StreamCallSession lets callers generate JSON-line request events while
// holding one persistent worker session, then reads NDJSON events until onEvent
// reports completion.
func StreamCallSession(
	ctx context.Context,
	w *Worker,
	sendRequests func(StreamSender) error,
	onEvent func(json.RawMessage) (bool, error),
) error {
	if w == nil {
		return fmt.Errorf("node process: nil worker")
	}
	if sendRequests == nil {
		return fmt.Errorf("node process: nil stream request sender")
	}
	if onEvent == nil {
		return fmt.Errorf("node process: nil stream event handler")
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	if err := ctx.Err(); err != nil {
		return err
	}
	if err := w.ensureSpawned(); err != nil {
		return err
	}

	send := func(req any) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if raw, ok := req.(RawJSONLine); ok {
			if len(raw) == 0 {
				return fmt.Errorf("node process: empty raw JSON request")
			}
			if _, err := w.stdin.Write(raw); err != nil {
				w.killLocked()
				return fmt.Errorf("write to worker: %w", err)
			}
			if _, err := w.stdin.Write([]byte{'\n'}); err != nil {
				w.killLocked()
				return fmt.Errorf("write to worker: %w", err)
			}
			return nil
		}
		data, err := json.Marshal(req)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		data = append(data, '\n')
		if _, err := w.stdin.Write(data); err != nil {
			w.killLocked()
			return fmt.Errorf("write to worker: %w", err)
		}
		return nil
	}

	if err := sendRequests(send); err != nil {
		w.killLocked()
		return err
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
