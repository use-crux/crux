package workerproc

import (
	"bufio"
	"context"
	"errors"
	"strings"
	"testing"
)

func TestScanLineHandlesMissingReader(t *testing.T) {
	result := scanLine(nil, defaultMaxResponseBytes)
	if result.err == nil {
		t.Fatal("scanLine(nil) error = nil, want stdout unavailable error")
	}
	if !strings.Contains(result.err.Error(), "stdout unavailable") {
		t.Fatalf("error = %q, want stdout unavailable", result.err)
	}
}

func TestScanLineRejectsOversizedResponse(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader(strings.Repeat("x", 32) + "\n"))

	result := scanLine(reader, 8)

	if result.err == nil {
		t.Fatal("scanLine error = nil, want oversized response error")
	}
	if !strings.Contains(result.err.Error(), "response exceeded") {
		t.Fatalf("scanLine error = %v, want response exceeded", result.err)
	}
}

func TestWorkerCallTypedAndWorkerError(t *testing.T) {
	worker := New(Script{Name: "fake"}, WithCommand(shellPath(t), fakePersistentWorker(t)))
	defer worker.Close()

	resp, err := Call[struct {
		Value string `json:"value"`
	}](context.Background(), worker, map[string]string{"mode": "ok"})
	if err != nil {
		t.Fatalf("Call error = %v", err)
	}
	if resp.Value != "ok" {
		t.Fatalf("resp.Value = %q, want ok", resp.Value)
	}

	_, err = Call[struct{}](context.Background(), worker, map[string]string{"mode": "error"})
	var workerErr *WorkerError
	if !errors.As(err, &workerErr) {
		t.Fatalf("Call error = %T %v, want WorkerError", err, err)
	}
	if workerErr.Script != "fake" || workerErr.Message != "bad request" {
		t.Fatalf("WorkerError = %#v, want fake bad request", workerErr)
	}
}
