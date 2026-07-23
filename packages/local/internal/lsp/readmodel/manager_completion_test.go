package readmodel

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestManagerEnablesAttachedCompletionOnlyForExactTransportContract(t *testing.T) {
	transport := NewAttachTransport(api.New("http://localhost:4598"))
	var got CompletionSource
	manager := NewManager(ManagerOptions{
		Version: "v-test", Transport: transport,
		OnCompletionSource: func(source CompletionSource) { got = source },
	})
	generation := uint64(3)
	manager.setAttachedCompletionSource(Snapshot{ServerVersion: "v-test", Generation: &generation})
	if got != transport {
		t.Fatalf("exact attached source = %#v, want transport", got)
	}

	manager.setAttachedCompletionSource(Snapshot{ServerVersion: "v-old", Generation: &generation})
	if got != nil {
		t.Fatalf("version-skew source = %#v, want nil", got)
	}
	manager.setAttachedCompletionSource(Snapshot{ServerVersion: "v-test"})
	if got != nil {
		t.Fatalf("generation-less source = %#v, want nil", got)
	}
	if manager.Mode() != "" {
		t.Fatalf("completion compatibility changed manager mode to %q", manager.Mode())
	}
}

func TestManagerReportsSnapshotAndEmptyDeltaGenerationChanges(t *testing.T) {
	t.Parallel()

	store := NewStore()
	changes := 0
	manager := NewManager(ManagerOptions{
		ScopeID: "scope",
		Store:   store,
		OnIndexChange: func() {
			changes++
		},
	})
	generation := uint64(7)
	manager.applySnapshot(Snapshot{Generation: &generation})
	manager.applySnapshot(Snapshot{Generation: &generation})
	if changes != 2 {
		t.Fatalf("snapshot identity callbacks = %d, want one per source replacement", changes)
	}

	if err := manager.applyDelta(context.Background(), Delta{
		Generation: 8,
		File:       "unchanged.ts",
	}); err != nil {
		t.Fatal(err)
	}
	if changes != 3 {
		t.Fatalf("empty generation delta callbacks = %d, want generation reset", changes)
	}
}
