package readmodel

import (
	"context"
	"errors"
	"testing"
)

func TestManagerRejectsSupersededSnapshotBeforeStoreMutation(t *testing.T) {
	t.Parallel()

	store := NewStore()
	currentGeneration := uint64(8)
	store.ApplySnapshot("scope", Snapshot{Generation: &currentGeneration})
	applied := false
	manager := NewManager(ManagerOptions{
		ScopeID: "scope",
		Store:   store,
		ApplyCurrent: func(apply func()) bool {
			applied = true
			return false
		},
	})
	staleGeneration := uint64(7)

	if manager.applySnapshot(Snapshot{Generation: &staleGeneration}) {
		t.Fatal("superseded snapshot was accepted")
	}
	if !applied {
		t.Fatal("manager did not consult its application authority")
	}
	publication := store.PublicationSnapshot("scope")
	if !publication.GenerationKnown || publication.Generation != currentGeneration {
		t.Fatalf(
			"store generation = (%d, %t), want (%d, true)",
			publication.Generation,
			publication.GenerationKnown,
			currentGeneration,
		)
	}
}

func TestManagerRejectsSupersededDeltaBeforeStoreMutation(t *testing.T) {
	t.Parallel()

	store := NewStore()
	currentGeneration := uint64(8)
	store.ApplySnapshot("scope", Snapshot{Generation: &currentGeneration})
	manager := NewManager(ManagerOptions{
		ScopeID: "scope",
		Store:   store,
		ApplyCurrent: func(func()) bool {
			return false
		},
	})

	err := manager.applyDelta(context.Background(), Delta{
		Generation: currentGeneration + 1,
		File:       "prompt.ts",
	})

	if !errors.Is(err, errManagerSuperseded) {
		t.Fatalf("delta error = %v, want manager superseded", err)
	}
	publication := store.PublicationSnapshot("scope")
	if !publication.GenerationKnown || publication.Generation != currentGeneration {
		t.Fatalf(
			"store generation = (%d, %t), want (%d, true)",
			publication.Generation,
			publication.GenerationKnown,
			currentGeneration,
		)
	}
}
