package server

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestWorkspaceCompletionWarnsAfterThreeScopeFailures(t *testing.T) {
	t.Parallel()

	fixture := newCompletionHealthFixture(t, "scope")
	fixture.source.err = errors.New("private compiler failure /workspace/secret.ts")

	for attempt, want := range []completionOutcomeKind{
		completionOutcomeWorkerFailure,
		completionOutcomeWorkerFailure,
		completionOutcomeWorkerFailureThreshold,
	} {
		got := fixture.complete(context.Background())
		if got.Kind != want {
			t.Fatalf("attempt %d outcome = %v, want %v", attempt+1, got.Kind, want)
		}
	}
}

func TestWorkspaceCompletionSuccessResetsScopeFailures(t *testing.T) {
	t.Parallel()

	fixture := newCompletionHealthFixture(t, "scope")
	fixture.source.err = errors.New("worker unavailable")
	fixture.complete(context.Background())
	fixture.complete(context.Background())

	fixture.source.err = nil
	if got := fixture.complete(context.Background()); got.Kind != completionOutcomeCurrent {
		t.Fatalf("success outcome = %v, want current", got.Kind)
	}
	fixture.source.err = errors.New("worker unavailable")
	if got := fixture.complete(context.Background()); got.Kind != completionOutcomeWorkerFailure {
		t.Fatalf("post-success failure = %v, want first worker failure", got.Kind)
	}
}

func TestWorkspaceCompletionSoftOutcomesDoNotAdvanceScopeFailures(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		soft      func(*completionHealthFixture) completionOutcome
		wantAfter completionOutcomeKind
	}{
		{
			name: "cancellation",
			soft: func(f *completionHealthFixture) completionOutcome {
				f.source.err = context.Canceled
				return f.complete(context.Background())
			},
			wantAfter: completionOutcomeWorkerFailureThreshold,
		},
		{
			name: "deadline",
			soft: func(f *completionHealthFixture) completionOutcome {
				f.source.err = context.DeadlineExceeded
				return f.complete(context.Background())
			},
			wantAfter: completionOutcomeWorkerFailureThreshold,
		},
		{
			name: "stale document",
			soft: func(f *completionHealthFixture) completionOutcome {
				f.source.err = nil
				f.source.result.DocumentVersion++
				return f.complete(context.Background())
			},
			wantAfter: completionOutcomeWorkerFailureThreshold,
		},
		{
			name: "stale generation",
			soft: func(f *completionHealthFixture) completionOutcome {
				f.source.err = nil
				f.source.result.Generation++
				return f.complete(context.Background())
			},
			wantAfter: completionOutcomeWorkerFailure,
		},
		{
			name: "empty unsupported or unsafe result",
			soft: func(f *completionHealthFixture) completionOutcome {
				f.source.err = nil
				f.source.result.Items = nil
				return f.complete(context.Background())
			},
			wantAfter: completionOutcomeWorkerFailure,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			fixture := newCompletionHealthFixture(t, "scope")
			fixture.source.err = errors.New("worker unavailable")
			fixture.complete(context.Background())
			fixture.complete(context.Background())

			if got := test.soft(fixture); got.Kind != completionOutcomeSoft {
				if test.name == "empty unsupported or unsafe result" &&
					got.Kind == completionOutcomeCurrent {
					// A valid empty result is a successful health signal.
				} else {
					t.Fatalf("soft outcome = %v, want soft/current", got.Kind)
				}
			}
			fixture.source.err = errors.New("worker unavailable")
			fixture.source.result = fixture.validResult()
			if got := fixture.complete(context.Background()); got.Kind != test.wantAfter {
				t.Fatalf("failure after %s = %v, want %v", test.name, got.Kind, test.wantAfter)
			}
		})
	}
}

func TestWorkspaceCompletionHandoverResetsScopeFailures(t *testing.T) {
	t.Parallel()

	fixture := newCompletionHealthFixture(t, "scope")
	fixture.source.err = errors.New("worker unavailable")
	fixture.complete(context.Background())
	fixture.complete(context.Background())

	fixture.workspace.setSessionMode(fixture.session, readmodel.ModeAttached)
	fixture.workspace.setSessionTransientSource(fixture.session, fixture.source)
	if got := fixture.complete(context.Background()); got.Kind != completionOutcomeWorkerFailure {
		t.Fatalf("post-handover failure = %v, want first worker failure", got.Kind)
	}
}

func TestWorkspaceCompletionCloseResetsScopeFailures(t *testing.T) {
	t.Parallel()

	fixture := newCompletionHealthFixture(t, "scope")
	fixture.source.err = errors.New("worker unavailable")
	fixture.complete(context.Background())
	fixture.complete(context.Background())

	fixture.workspace.DidClose(fixture.uri)
	if got := fixture.complete(context.Background()); got.Kind != completionOutcomeWorkerFailure {
		t.Fatalf("post-close failure = %v, want first worker failure", got.Kind)
	}
}

func TestWorkspaceCompletionReindexDiscardsLateFailureAndResetsHealth(t *testing.T) {
	t.Parallel()

	fixture := newCompletionHealthFixture(t, "scope")
	fixture.source.err = errors.New("worker unavailable")
	fixture.complete(context.Background())
	fixture.complete(context.Background())

	fixture.source.started = make(chan struct{})
	fixture.source.release = make(chan struct{})
	outcome := make(chan completionOutcome, 1)
	go func() {
		outcome <- fixture.complete(context.Background())
	}()
	<-fixture.source.started
	fixture.workspace.invalidateTransientSource(fixture.session)
	close(fixture.source.release)
	if got := <-outcome; got.Kind != completionOutcomeSoft {
		t.Fatalf("late pre-reindex failure = %v, want health-neutral soft outcome", got.Kind)
	}

	fixture.source.started = nil
	fixture.source.release = nil
	for attempt, want := range []completionOutcomeKind{
		completionOutcomeWorkerFailure,
		completionOutcomeWorkerFailure,
		completionOutcomeWorkerFailureThreshold,
	} {
		if got := fixture.complete(context.Background()); got.Kind != want {
			t.Fatalf("post-reindex attempt %d = %v, want %v", attempt+1, got.Kind, want)
		}
	}
}

func TestWorkspaceCompletionFailureCountersArePerScope(t *testing.T) {
	t.Parallel()

	generation := uint64(7)
	store := readmodel.NewStore()
	workspace := &workspaceRuntime{store: store}
	type scopedSource struct {
		uri protocol.DocumentURI
	}
	var scopes []scopedSource
	for _, id := range []string{"scope-a", "scope-b"} {
		root := t.TempDir()
		store.ApplySnapshot(id, readmodel.Snapshot{Generation: &generation})
		source := &controlledCompletionSource{
			result: readmodel.CompletionResult{
				DocumentVersion: 4, Generation: generation,
			},
			err: errors.New("worker unavailable"),
		}
		workspace.sessions = append(workspace.sessions, &scopeSession{
			scope: readmodel.Scope{ID: id, Root: root},
			mode:  readmodel.ModeOwn, transient: source, sourceEpoch: 1,
		})
		scopes = append(scopes, scopedSource{
			uri: protocol.DocumentURI(
				"file://" + filepath.ToSlash(filepath.Join(root, "src", "agent.ts")),
			),
		})
	}
	request := readmodel.CompletionRequest{DocumentVersion: 4}
	for attempt := 0; attempt < 2; attempt++ {
		for _, scope := range scopes {
			if got := workspace.Completion(context.Background(), scope.uri, request); got.Kind != completionOutcomeWorkerFailure {
				t.Fatalf("scope attempt %d outcome = %v, want worker failure", attempt+1, got.Kind)
			}
		}
	}
	for _, scope := range scopes {
		if got := workspace.Completion(context.Background(), scope.uri, request); got.Kind != completionOutcomeWorkerFailureThreshold {
			t.Fatalf("scope threshold outcome = %v, want independent threshold", got.Kind)
		}
	}
}

type completionHealthFixture struct {
	workspace  *workspaceRuntime
	session    *scopeSession
	source     *controlledCompletionSource
	uri        protocol.DocumentURI
	request    readmodel.CompletionRequest
	generation uint64
}

func newCompletionHealthFixture(t *testing.T, scope string) *completionHealthFixture {
	t.Helper()
	root := t.TempDir()
	generation := uint64(7)
	store := readmodel.NewStore()
	store.ApplySnapshot(scope, readmodel.Snapshot{Generation: &generation})
	source := &controlledCompletionSource{result: readmodel.CompletionResult{
		DocumentVersion: 4, Generation: generation,
	}}
	session := &scopeSession{
		scope: readmodel.Scope{ID: scope, Root: root},
		mode:  readmodel.ModeOwn, transient: source, sourceEpoch: 1,
	}
	session.publisher = NewPublisher(PublisherOptions{
		ScopeID: scope,
		Root:    root,
		Store:   store,
	})
	return &completionHealthFixture{
		workspace: &workspaceRuntime{store: store, sessions: []*scopeSession{session}},
		session:   session,
		source:    source,
		uri: protocol.DocumentURI(
			"file://" + filepath.ToSlash(filepath.Join(root, "src", "agent.ts")),
		),
		request:    readmodel.CompletionRequest{DocumentVersion: 4},
		generation: generation,
	}
}

func (f *completionHealthFixture) complete(ctx context.Context) completionOutcome {
	return f.workspace.Completion(ctx, f.uri, f.request)
}

func (f *completionHealthFixture) validResult() readmodel.CompletionResult {
	return readmodel.CompletionResult{
		DocumentVersion: f.request.DocumentVersion,
		Generation:      f.generation,
	}
}
