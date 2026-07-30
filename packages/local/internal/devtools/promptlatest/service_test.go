package promptlatest

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type latestRunsStub struct {
	calls    int
	snapshot observability.LatestDefinitionOperationSnapshot
	after    func(call int)
}

func (s *latestRunsStub) LatestOperationForDefinition(
	context.Context,
	string,
) (observability.LatestDefinitionOperationSnapshot, error) {
	s.calls++
	if s.after != nil {
		s.after(s.calls)
	}
	return s.snapshot, nil
}

type availabilityStub struct {
	available bool
	calls     int
}

func (s *availabilityStub) HasPromptPreviewTarget(string) bool {
	s.calls++
	return s.available
}

func TestResolveRetriesOwnerMoveWithStableDefinitionID(t *testing.T) {
	indexStore := store.NewStore()
	indexStore.SetIndexData(promptIndex("src/before.ts", "prompt"))
	runs := &latestRunsStub{
		snapshot: observability.LatestDefinitionOperationSnapshot{
			Revision: 7, OperationID: "operation-latest",
		},
	}
	runs.after = func(call int) {
		if call == 1 {
			indexStore.SetIndexData(promptIndex("src/after.ts", "prompt"))
		}
	}
	service := New(indexStore, runs, &availabilityStub{})

	result, err := service.Resolve(context.Background(), "prompt:greeting")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusFound ||
		result.DefinitionID != "prompt:greeting" ||
		result.ObservabilityRevision != 7 ||
		result.OperationID != "operation-latest" {
		t.Fatalf("result = %+v", result)
	}
	if runs.calls != 2 {
		t.Fatalf("latest-operation reads = %d, want 2", runs.calls)
	}
}

func TestResolveRejectsOwnerDeletedDuringSelection(t *testing.T) {
	indexStore := store.NewStore()
	indexStore.SetIndexData(promptIndex("src/prompt.ts", "prompt"))
	runs := &latestRunsStub{
		snapshot: observability.LatestDefinitionOperationSnapshot{
			Revision: 7, OperationID: "operation-historical",
		},
		after: func(call int) {
			if call == 1 {
				indexStore.SetIndexData(store.IndexData{})
			}
		},
	}
	service := New(indexStore, runs, &availabilityStub{})

	result, err := service.Resolve(context.Background(), "prompt:greeting")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusUnavailable ||
		result.UnavailableReason != ReasonOwnerNotFound {
		t.Fatalf("result = %+v", result)
	}
	if runs.calls != 1 {
		t.Fatalf("latest-operation reads = %d, want 1", runs.calls)
	}
}

func TestResolveRejectsOwnerRenamedDuringSelection(t *testing.T) {
	indexStore := store.NewStore()
	indexStore.SetIndexData(promptIndex("src/prompt.ts", "prompt"))
	runs := &latestRunsStub{
		snapshot: observability.LatestDefinitionOperationSnapshot{
			Revision: 7, OperationID: "operation-historical",
		},
		after: func(call int) {
			if call == 1 {
				indexStore.SetIndexData(store.IndexData{
					Definitions: []store.ProjectDefinition{{
						ID: "prompt:renamed", Kind: "prompt", Name: "Greeting",
					}},
				})
			}
		},
	}

	result, err := New(indexStore, runs, &availabilityStub{}).
		Resolve(context.Background(), "prompt:greeting")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusUnavailable ||
		result.UnavailableReason != ReasonOwnerNotFound {
		t.Fatalf("result = %+v", result)
	}
}

func TestResolveRejectsOwnerThatBecomesNonPrompt(t *testing.T) {
	indexStore := store.NewStore()
	indexStore.SetIndexData(promptIndex("src/prompt.ts", "prompt"))
	runs := &latestRunsStub{
		snapshot: observability.LatestDefinitionOperationSnapshot{
			Revision: 7, OperationID: "operation-historical",
		},
		after: func(call int) {
			if call == 1 {
				indexStore.SetIndexData(promptIndex("src/context.ts", "context"))
			}
		},
	}

	result, err := New(indexStore, runs, &availabilityStub{}).
		Resolve(context.Background(), "prompt:greeting")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusUnavailable ||
		result.UnavailableReason != ReasonOwnerNotPrompt {
		t.Fatalf("result = %+v", result)
	}
}

func TestResolveRejectsAmbiguousCurrentOwner(t *testing.T) {
	indexStore := store.NewStore()
	indexStore.SetIndexData(store.IndexData{
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:greeting", Kind: "prompt", Name: "First"},
			{ID: "prompt:greeting", Kind: "prompt", Name: "Second"},
		},
	})
	runs := &latestRunsStub{}

	result, err := New(indexStore, runs, &availabilityStub{}).
		Resolve(context.Background(), "prompt:greeting")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusUnavailable ||
		result.UnavailableReason != ReasonOwnerNotFound {
		t.Fatalf("result = %+v", result)
	}
	if runs.calls != 0 {
		t.Fatalf("latest-operation reads = %d, want 0", runs.calls)
	}
}

func TestResolveStopsAfterThreePublicationChanges(t *testing.T) {
	indexStore := store.NewStore()
	indexStore.SetIndexData(promptIndex("src/prompt.ts", "prompt"))
	runs := &latestRunsStub{
		snapshot: observability.LatestDefinitionOperationSnapshot{
			Revision: 7, OperationID: "operation-latest",
		},
		after: func(int) {
			indexStore.SetIndexData(promptIndex("src/moved.ts", "prompt"))
		},
	}

	_, err := New(indexStore, runs, &availabilityStub{}).
		Resolve(context.Background(), "prompt:greeting")
	if err != ErrTemporarilyUnavailable {
		t.Fatalf("error = %v, want %v", err, ErrTemporarilyUnavailable)
	}
	if runs.calls != maxResolveAttempts {
		t.Fatalf("latest-operation reads = %d, want %d", runs.calls, maxResolveAttempts)
	}
}

func TestResolveSnapshotsExactPreviewAvailabilityOnlyForEmptyRuns(t *testing.T) {
	for _, test := range []struct {
		name      string
		operation string
		available bool
		wantCalls int
		want      bool
	}{
		{
			name: "empty and available", available: true,
			wantCalls: 1, want: true,
		},
		{
			name: "empty and unavailable", available: false,
			wantCalls: 1, want: false,
		},
		{
			name: "found skips availability", operation: "operation-latest",
			available: true, wantCalls: 0, want: false,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			indexStore := store.NewStore()
			indexStore.SetIndexData(promptIndex("src/prompt.ts", "prompt"))
			runs := &latestRunsStub{
				snapshot: observability.LatestDefinitionOperationSnapshot{
					Revision: 9, OperationID: test.operation,
				},
			}
			availability := &availabilityStub{available: test.available}

			result, err := New(indexStore, runs, availability).
				Resolve(context.Background(), "prompt:greeting")
			if err != nil {
				t.Fatal(err)
			}
			if availability.calls != test.wantCalls {
				t.Fatalf(
					"availability calls = %d, want %d",
					availability.calls,
					test.wantCalls,
				)
			}
			if result.ExactPreviewAvailable != test.want {
				t.Fatalf("result = %+v", result)
			}
		})
	}
}

func promptIndex(file, kind string) store.IndexData {
	return store.IndexData{
		Definitions: []store.ProjectDefinition{{
			ID: "prompt:greeting", Kind: kind, Name: "Greeting",
			Source: &store.SourceLoc{File: file},
		}},
	}
}
