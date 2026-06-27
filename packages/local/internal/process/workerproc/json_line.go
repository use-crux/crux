package workerproc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// WorkerError is a protocol-level error reported by the worker itself.
type WorkerError struct {
	Script  string
	Message string
}

func (e *WorkerError) Error() string {
	if e.Script == "" {
		return e.Message
	}
	return fmt.Sprintf("%s worker: %s", e.Script, e.Message)
}

// Call marshals req as a JSON line, reads one response line, and unmarshals it
// into Resp. Go methods cannot be generic, so this is package-level.
func Call[Resp any](ctx context.Context, w *Worker, req any) (Resp, error) {
	var zero Resp
	raw, err := CallRaw(ctx, w, req)
	if err != nil {
		return zero, err
	}
	var resp Resp
	if err := json.Unmarshal(raw, &resp); err != nil {
		return zero, fmt.Errorf("unmarshal response: %w", err)
	}
	return resp, nil
}

// CallRaw performs a single JSON-line request/response round trip.
func CallRaw(ctx context.Context, w *Worker, req any) (json.RawMessage, error) {
	if w == nil {
		return nil, fmt.Errorf("worker process: nil worker")
	}
	w.mu.Lock()
	defer w.mu.Unlock()

	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := w.ensureSpawned(); err != nil {
		return nil, err
	}

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	data = append(data, '\n')
	if _, err := w.stdin.Write(data); err != nil {
		w.killLocked()
		return nil, fmt.Errorf("write to worker: %w", err)
	}

	stdout := w.stdout
	resultCh := make(chan scanResult, 1)
	go func() {
		resultCh <- scanLine(stdout, w.config.maxResponseBytes)
	}()

	select {
	case <-ctx.Done():
		err := ctx.Err()
		w.killLocked()
		return nil, err
	case result := <-resultCh:
		if result.err != nil {
			w.killLocked()
			return nil, result.err
		}
		if workerErr := decodeWorkerError(w.script.Name, result.bytes); workerErr != nil {
			return nil, workerErr
		}
		return json.RawMessage(result.bytes), nil
	}
}

type scanResult struct {
	bytes []byte
	err   error
}

func scanLine(stdout *bufio.Reader, maxBytes int) scanResult {
	if stdout == nil {
		return scanResult{err: fmt.Errorf("worker process: stdout unavailable")}
	}
	var line []byte
	for {
		chunk, err := stdout.ReadSlice('\n')
		line = append(line, chunk...)
		if maxBytes > 0 && len(line) > maxBytes {
			return scanResult{err: fmt.Errorf("worker process: response exceeded %d bytes", maxBytes)}
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if errors.Is(err, io.EOF) && len(line) == 0 {
			return scanResult{err: fmt.Errorf("worker process: no output (EOF)")}
		}
		if err != nil && !errors.Is(err, io.EOF) {
			return scanResult{err: fmt.Errorf("worker process: read response: %w", err)}
		}
		break
	}
	line = bytes.TrimSuffix(line, []byte("\n"))
	line = bytes.TrimSuffix(line, []byte("\r"))
	return scanResult{bytes: line}
}

func decodeWorkerError(script string, raw []byte) error {
	var envelope struct {
		Error string `json:"error,omitempty"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil
	}
	if envelope.Error == "" {
		return nil
	}
	return &WorkerError{Script: script, Message: envelope.Error}
}
