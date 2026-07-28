package server

import (
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestWorkspaceCloseSerializesPromptTextTransformRetirement(t *testing.T) {
	t.Parallel()

	session := &scopeSession{publisher: &Publisher{}}
	workspace := &workspaceRuntime{sessions: []*scopeSession{session}}
	assertPromptTextTransitionBlocks(t, session, workspace.Close)
}

func TestManagerRestartSerializesPromptTextTransformRetirement(t *testing.T) {
	t.Parallel()

	session := &scopeSession{}
	workspace := &workspaceRuntime{}
	assertPromptTextTransitionBlocks(t, session, func() {
		workspace.restartManager(session)
	})
}

func TestManagerRestartSynchronouslyReplacesSourceAuthority(t *testing.T) {
	t.Parallel()

	session := &scopeSession{
		mode: readmodel.ModeAttached, transient: lifecyclePromptTextSource{},
		sourceEpoch: 4, managerGeneration: 7,
	}
	workspace := &workspaceRuntime{}

	workspace.restartManager(session)

	if session.mode != readmodel.ModeDiscovering ||
		session.transient != nil ||
		session.sourceEpoch != 5 ||
		session.managerGeneration != 8 {
		t.Fatalf(
			"restart authority = mode %q, source %T, epoch %d, manager %d",
			session.mode,
			session.transient,
			session.sourceEpoch,
			session.managerGeneration,
		)
	}
}

func TestSupersededManagerCallbackCannotClobberReplacementSource(t *testing.T) {
	t.Parallel()

	source := lifecyclePromptTextSource{}
	session := &scopeSession{
		transient: source, sourceEpoch: 9, managerGeneration: 1,
	}
	workspace := &workspaceRuntime{}
	session.promptTextTransition.Lock()
	done := make(chan struct{})
	applied := make(chan struct{})
	go func() {
		defer close(done)
		workspace.runManagerCallback(session, 1, func() {
			close(applied)
			workspace.setSessionTransientSourceLocked(session, nil)
		})
	}()

	workspace.mu.Lock()
	session.managerGeneration = 2
	workspace.mu.Unlock()
	session.promptTextTransition.Unlock()
	<-done

	select {
	case <-applied:
		t.Fatal("superseded manager callback was applied")
	default:
	}
	if session.transient != source || session.sourceEpoch != 9 {
		t.Fatalf(
			"replacement authority was clobbered: source %T, epoch %d",
			session.transient,
			session.sourceEpoch,
		)
	}
}

func TestSupersededManagerCannotApplyQueuedSnapshot(t *testing.T) {
	t.Parallel()

	store := readmodel.NewStore()
	currentGeneration := uint64(12)
	store.ApplySnapshot("scope", readmodel.Snapshot{Generation: &currentGeneration})
	session := &scopeSession{managerGeneration: 2}
	workspace := &workspaceRuntime{store: store}
	staleGeneration := uint64(11)

	accepted := workspace.runManagerApply(session, 1, func() {
		store.ApplySnapshot("scope", readmodel.Snapshot{Generation: &staleGeneration})
	})

	if accepted {
		t.Fatal("superseded manager snapshot was accepted")
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

func assertPromptTextTransitionBlocks(
	t *testing.T,
	session *scopeSession,
	operation func(),
) {
	t.Helper()
	session.promptTextTransition.Lock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		operation()
	}()

	select {
	case <-done:
		session.promptTextTransition.Unlock()
		t.Fatal("lifecycle mutation bypassed the PromptText transition boundary")
	case <-time.After(25 * time.Millisecond):
	}
	session.promptTextTransition.Unlock()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("lifecycle mutation did not resume after transition release")
	}
}
