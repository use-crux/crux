package readmodel

import (
	"context"
	"encoding/json"
	"slices"
	"sync"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestManagerHandoverEstablishesAttachedTransientSourceBeforeRetiringOwn(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	file := root + "/writer.ts"
	transport := NewAttachTransport(api.New("http://localhost:4598"))
	events := []string{"own"}
	ctx, cancel := context.WithCancel(context.Background())
	manager := NewManager(ManagerOptions{
		ScopeID:   root,
		Root:      root,
		Version:   "v-test",
		Transport: transport,
		Connect: func(context.Context, string) (MessageStream, error) {
			return newScriptedStream(
				[]json.RawMessage{snapshotJSON(root, file, "attached", 1)},
				nil,
			), nil
		},
		OnTransientSource: func(source TransientSource) {
			switch source {
			case nil:
				events = append(events, "none")
			case transport:
				events = append(events, "attached")
				cancel()
			default:
				events = append(events, "other")
			}
		},
	})
	own := &recordingOwnTransientSource{
		snapshots: make(chan Snapshot),
		close:     func() { events = append(events, "close-own") },
	}

	ok := manager.handoverToAttached(
		ctx,
		func() { events = append(events, "stop-own") },
		own,
	)
	if !ok {
		t.Fatal("handover was not accepted")
	}
	want := []string{"own", "attached", "stop-own", "close-own"}
	if !slices.Equal(events, want) {
		t.Fatalf("handover events = %v, want establish-before-retire %v", events, want)
	}
}

type recordingOwnTransientSource struct {
	snapshots chan Snapshot
	close     func()
	once      sync.Once
}

func (s *recordingOwnTransientSource) Snapshots() <-chan Snapshot { return s.snapshots }
func (s *recordingOwnTransientSource) Close() {
	s.once.Do(s.close)
}
func (*recordingOwnTransientSource) Completion(
	context.Context,
	CompletionRequest,
) (CompletionResult, error) {
	return CompletionResult{}, nil
}
func (*recordingOwnTransientSource) PromptText(
	context.Context,
	PromptTextRequest,
) (PromptTextResult, error) {
	return PromptTextResult{}, nil
}
