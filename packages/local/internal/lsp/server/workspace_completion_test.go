package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestWorkspaceCompletionRejectsGenerationAdvance(t *testing.T) {
	root := t.TempDir()
	uri := protocol.DocumentURI("file://" + filepath.ToSlash(filepath.Join(root, "src", "agent.ts")))
	store := readmodel.NewStore()
	firstGeneration := uint64(7)
	store.ApplySnapshot("scope", readmodel.Snapshot{Generation: &firstGeneration})
	source := &controlledCompletionSource{
		started: make(chan struct{}), release: make(chan struct{}),
		result: readmodel.CompletionResult{Generation: firstGeneration},
	}
	session := &scopeSession{
		scope: readmodel.Scope{ID: "scope", Root: root}, mode: readmodel.ModeOwn,
		completion: source, sourceEpoch: 1,
	}
	workspace := &workspaceRuntime{store: store, sessions: []*scopeSession{session}}
	done := make(chan completionOutcome, 1)
	go func() {
		done <- workspace.Completion(context.Background(), uri, readmodel.CompletionRequest{})
	}()
	<-source.started
	secondGeneration := uint64(8)
	store.ApplySnapshot("scope", readmodel.Snapshot{Generation: &secondGeneration})
	close(source.release)

	if outcome := <-done; outcome.Kind != completionOutcomeSoft {
		t.Fatalf("late completion = %+v, want soft stale generation", outcome)
	}
}

func TestWorkspaceCompletionAcceptsAttachedPinnedResult(t *testing.T) {
	root := t.TempDir()
	uri := protocol.DocumentURI("file://" + filepath.ToSlash(filepath.Join(root, "src", "agent.ts")))
	store := readmodel.NewStore()
	generation := uint64(7)
	store.ApplySnapshot("scope", readmodel.Snapshot{Generation: &generation})
	source := &controlledCompletionSource{result: readmodel.CompletionResult{
		DocumentVersion: 4, Generation: generation,
	}}
	session := &scopeSession{
		scope: readmodel.Scope{ID: "scope", Root: root}, mode: readmodel.ModeAttached,
		completion: source, sourceEpoch: 2,
	}
	workspace := &workspaceRuntime{store: store, sessions: []*scopeSession{session}}
	outcome := workspace.Completion(context.Background(), uri, readmodel.CompletionRequest{DocumentVersion: 4})
	if outcome.Kind != completionOutcomeCurrent ||
		outcome.Result.DocumentVersion != 4 ||
		outcome.Result.Generation != 7 {
		t.Fatalf("attached completion = %+v, want current V4/G7", outcome)
	}
}

func TestWorkspaceCompletionDoesNotMutatePublicationViews(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	file := filepath.Join(root, "src", "agent.ts")
	uri := protocol.DocumentURI("file://" + filepath.ToSlash(file))
	store := readmodel.NewStore()
	generation := uint64(9)
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings: []api.IndexLintFinding{{
			ID: "finding:writer", RuleID: "definition.missing_eval_coverage",
			Source: &api.SourceLoc{File: file, Line: 4},
		}},
		Definitions: []api.ProjectDefinition{{
			ID: "prompt:writer", Kind: "prompt", Name: "writer",
			Source: &api.SourceLoc{File: file, Line: 4},
			SourceRefs: []api.ProjectSourceRef{{
				ID: "ref:writer", Role: "config",
				Source: api.SourceLoc{File: file, Line: 8},
			}},
		}},
		Relations: []api.ProjectRelation{{
			ID: "relation:writer", Type: "agent.uses_prompt",
			From: "agent:support", To: "prompt:writer",
			Source: &api.SourceLoc{File: file, Line: 8},
		}},
	})
	source := &controlledCompletionSource{result: readmodel.CompletionResult{
		DocumentVersion: 17, Generation: generation,
	}}
	workspace := &workspaceRuntime{
		store: store,
		sessions: []*scopeSession{{
			scope: readmodel.Scope{ID: "scope", Root: root},
			mode:  readmodel.ModeOwn, completion: source, sourceEpoch: 1,
		}},
	}
	before := store.PublicationSnapshot("scope")

	if outcome := workspace.Completion(context.Background(), uri, readmodel.CompletionRequest{
		DocumentVersion: 17,
		Text:            "const unsavedSecret = agent({ prompt: wr",
	}); outcome.Kind != completionOutcomeCurrent {
		t.Fatalf("current completion outcome = %+v", outcome)
	}

	after := store.PublicationSnapshot("scope")
	if !reflect.DeepEqual(after, before) {
		t.Fatalf("completion mutated publication views:\nbefore=%+v\nafter=%+v", before, after)
	}
}

func TestWorkspaceCompletionRejectsModeSourceEpochAdvance(t *testing.T) {
	root := t.TempDir()
	uri := protocol.DocumentURI("file://" + filepath.ToSlash(filepath.Join(root, "src", "agent.ts")))
	store := readmodel.NewStore()
	generation := uint64(7)
	store.ApplySnapshot("scope", readmodel.Snapshot{Generation: &generation})
	source := &controlledCompletionSource{
		started: make(chan struct{}), release: make(chan struct{}),
		result: readmodel.CompletionResult{Generation: generation},
	}
	session := &scopeSession{
		scope: readmodel.Scope{ID: "scope", Root: root}, mode: readmodel.ModeOwn,
		completion: source, sourceEpoch: 1,
	}
	workspace := &workspaceRuntime{store: store, sessions: []*scopeSession{session}}
	done := make(chan completionOutcome, 1)
	go func() {
		done <- workspace.Completion(context.Background(), uri, readmodel.CompletionRequest{})
	}()
	<-source.started
	workspace.setSessionMode(session, readmodel.ModeReconnect)
	close(source.release)
	if outcome := <-done; outcome.Kind != completionOutcomeSoft {
		t.Fatalf("completion survived OWN source epoch advance: %+v", outcome)
	}
}

func TestWorkspaceCompletionRejectsBothHandoverDirections(t *testing.T) {
	for _, test := range []struct {
		name string
		from readmodel.Mode
		to   readmodel.Mode
	}{
		{name: "attached to own", from: readmodel.ModeAttached, to: readmodel.ModeOwn},
		{name: "own to attached", from: readmodel.ModeOwn, to: readmodel.ModeAttached},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			uri := protocol.DocumentURI("file://" + filepath.ToSlash(filepath.Join(root, "src", "agent.ts")))
			store := readmodel.NewStore()
			generation := uint64(7)
			store.ApplySnapshot("scope", readmodel.Snapshot{Generation: &generation})
			source := &controlledCompletionSource{
				started: make(chan struct{}), release: make(chan struct{}),
				result: readmodel.CompletionResult{Generation: generation},
			}
			session := &scopeSession{
				scope: readmodel.Scope{ID: "scope", Root: root}, mode: test.from,
				completion: source, sourceEpoch: 1,
			}
			workspace := &workspaceRuntime{store: store, sessions: []*scopeSession{session}}
			done := make(chan completionOutcome, 1)
			go func() {
				done <- workspace.Completion(context.Background(), uri, readmodel.CompletionRequest{})
			}()
			<-source.started
			workspace.setSessionMode(session, test.to)
			close(source.release)
			if outcome := <-done; outcome.Kind != completionOutcomeSoft {
				t.Fatalf("completion survived %s → %s handover: %+v", test.from, test.to, outcome)
			}
		})
	}
}

func TestWorkspaceCompletionBoundsAttachedTransportLatency(t *testing.T) {
	root := t.TempDir()
	uri := protocol.DocumentURI("file://" + filepath.ToSlash(filepath.Join(root, "src", "agent.ts")))
	store := readmodel.NewStore()
	generation := uint64(2)
	store.ApplySnapshot("scope", readmodel.Snapshot{Generation: &generation})
	source := &controlledCompletionSource{waitForContext: true}
	workspace := &workspaceRuntime{store: store, sessions: []*scopeSession{{
		scope: readmodel.Scope{ID: "scope", Root: root}, mode: readmodel.ModeAttached,
		completion: source, sourceEpoch: 1,
	}}}
	started := time.Now()
	if outcome := workspace.Completion(context.Background(), uri, readmodel.CompletionRequest{}); outcome.Kind != completionOutcomeSoft {
		t.Fatalf("timed out completion = %+v, want soft", outcome)
	}
	if elapsed := time.Since(started); elapsed < completionDeadline || elapsed > time.Second {
		t.Fatalf("completion elapsed %s, want bounded near %s", elapsed, completionDeadline)
	}
}

func TestWorkspaceCompletionRouteAbsenceDoesNotLeaveAttachedMode(t *testing.T) {
	root := t.TempDir()
	uri := protocol.DocumentURI("file://" + filepath.ToSlash(filepath.Join(root, "src", "agent.ts")))
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	transport := readmodel.NewAttachTransport(api.New(server.URL))
	store := readmodel.NewStore()
	generation := uint64(5)
	store.ApplySnapshot("scope", readmodel.Snapshot{Generation: &generation})
	session := &scopeSession{
		scope: readmodel.Scope{ID: "scope", Root: root}, mode: readmodel.ModeAttached,
		completion: transport, sourceEpoch: 3,
	}
	workspace := &workspaceRuntime{store: store, sessions: []*scopeSession{session}}
	if outcome := workspace.Completion(context.Background(), uri, readmodel.CompletionRequest{}); outcome.Kind != completionOutcomeSoft {
		t.Fatalf("missing attached completion route = %+v, want soft unavailable", outcome)
	}
	if session.mode != readmodel.ModeAttached || session.completion != transport || session.sourceEpoch != 3 {
		t.Fatalf("completion failure changed lifecycle state: mode=%s source=%T epoch=%d", session.mode, session.completion, session.sourceEpoch)
	}
}

type controlledCompletionSource struct {
	started        chan struct{}
	release        chan struct{}
	result         readmodel.CompletionResult
	err            error
	waitForContext bool
}

func (s *controlledCompletionSource) Completion(ctx context.Context, _ readmodel.CompletionRequest) (readmodel.CompletionResult, error) {
	if s.started != nil {
		close(s.started)
	}
	if s.release != nil {
		<-s.release
	}
	if s.waitForContext {
		<-ctx.Done()
		return readmodel.CompletionResult{}, errors.New("completion context ended")
	}
	return s.result, s.err
}
