package workerproc

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestStreamDeliversEventsAndCapturesExitErr(t *testing.T) {
	var events []string
	result, err := Stream(context.Background(), OneShot{
		CommandPath: shellPath(t),
		CommandArgs: []string{fakeStreamWorker(t)},
	}, func(raw json.RawMessage) error {
		var event struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &event); err != nil {
			t.Fatalf("unmarshal event: %v", err)
		}
		events = append(events, event.Type)
		return nil
	})
	if err != nil {
		t.Fatalf("Stream error = %v", err)
	}
	if result.ExitErr == nil {
		t.Fatal("Stream ExitErr = nil, want nonzero exit")
	}
	if !strings.Contains(result.Stderr, "stream stderr") {
		t.Fatalf("Stream stderr = %q, want captured stderr", result.Stderr)
	}
	if strings.Join(events, ",") != "first,second" {
		t.Fatalf("events = %v, want first,second", events)
	}
}

func TestStreamCallSessionSendsGeneratedRequests(t *testing.T) {
	worker := New(Script{Name: "fake-session"}, WithCommand(shellPath(t), fakeSessionWorker(t)))
	defer worker.Close()

	var events []string
	err := StreamCallSession(
		context.Background(),
		worker,
		func(send StreamSender) error {
			if err := send(map[string]string{"kind": "start"}); err != nil {
				return err
			}
			if err := send(RawJSONLine(`{"kind":"chunk"}`)); err != nil {
				return err
			}
			return send(map[string]string{"kind": "done"})
		},
		func(raw json.RawMessage) (bool, error) {
			var event struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(raw, &event); err != nil {
				return false, err
			}
			events = append(events, event.Type)
			return event.Type == "done", nil
		},
	)
	if err != nil {
		t.Fatalf("StreamCallSession error = %v", err)
	}
	if strings.Join(events, ",") != "summary,done" {
		t.Fatalf("events = %v, want summary,done", events)
	}
}

func TestStreamCancellationKillsProcess(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err := Stream(ctx, OneShot{
		CommandPath: shellPath(t),
		CommandArgs: []string{fakeSlowStreamWorker(t)},
	}, func(json.RawMessage) error {
		t.Fatal("unexpected event")
		return nil
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Stream error = %v, want deadline exceeded", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("Stream took %s, want bounded cancellation", elapsed)
	}
}
